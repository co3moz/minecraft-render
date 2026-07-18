import { destroyRenderer, prepareRenderer, render } from './render.js';
import { Jar } from './utils/jar.js';
import {
  renderPool,
  type ParallelRenderResult,
} from './utils/render-pool.js';
import type {
  AnimationMeta,
  BlockModel,
  Renderer,
  RendererOptions,
} from './utils/types.js';
//@ts-ignore
import deepAssign from 'assign-deep';

export type MinecraftSource = string | Jar;

export class Minecraft {
  protected jars: Jar[];
  protected renderer!: Renderer | null;
  protected _cache: { [key: string]: any } = {};
  protected _namespace: string | null = null;

  protected constructor(source: MinecraftSource | MinecraftSource[]) {
    const sources = Array.isArray(source) ? source : [source];
    if (sources.length === 0) {
      throw new Error('Minecraft.open requires at least one jar');
    }
    this.jars = sources.map((s) => (s instanceof Jar ? s : Jar.open(s)));
  }

  /**
   * Opens one or more jars. The first is the primary source (e.g. a mod jar);
   * later ones are fallbacks (e.g. the vanilla jar) searched in order when an
   * asset — a vanilla parent model or texture referenced by the mod — is not in
   * an earlier jar.
   */
  static open(source: MinecraftSource | MinecraftSource[]) {
    return new Minecraft(source);
  }

  /** File path of the first (primary) jar. */
  get file(): string {
    return this.jars[0].file;
  }

  /**
   * The primary asset namespace to enumerate and render. Auto-detected as the
   * first non-`minecraft` namespace that ships block models (a mod's id), or
   * `minecraft` for a vanilla jar.
   */
  async namespace(): Promise<string> {
    if (this._namespace) return this._namespace;

    const namespaces = new Set<string>();
    for (const jar of this.jars) {
      for (const entry of await jar.entries('assets/')) {
        const match = /^assets\/([^/]+)\/models\/block\//.exec(entry.name);
        if (match) namespaces.add(match[1]);
      }
    }

    const modNamespace = [...namespaces].find((ns) => ns !== 'minecraft');
    return (this._namespace = modNamespace ?? 'minecraft');
  }

  async getBlockNameList(): Promise<string[]> {
    const prefix = `assets/${await this.namespace()}/models/block/`;
    const names = new Set<string>();

    for (const jar of this.jars) {
      for (const entry of await jar.entries(prefix)) {
        if (entry.name.endsWith('.json')) {
          names.add(entry.name.slice(prefix.length, -'.json'.length));
        }
      }
    }

    return [...names];
  }

  async getBlockList(): Promise<BlockModel[]> {
    return await Promise.all(
      (await this.getBlockNameList()).map((block) => this.getModel(block)),
    );
  }

  async getModelFile<T = BlockModel>(name = 'block/block'): Promise<T> {
    const path = resolveAssetPath(name, 'models', '.json');

    try {
      if (this._cache[path]) {
        return JSON.parse(JSON.stringify(this._cache[path]));
      }

      this._cache[path] = await this.readJson(path);

      return this._cache[path];
    } catch (e) {
      throw new Error(`Unable to find model file: ${path}`);
    }
  }

  async getTextureFile(name: string = '') {
    const path = resolveAssetPath(name ?? '', 'textures', '.png');

    try {
      return await this.read(path);
    } catch (e) {
      throw new Error(`Unable to find texture file: ${path}`);
    }
  }

  async getTextureMetadata(name: string = ''): Promise<AnimationMeta | null> {
    const path = resolveAssetPath(name ?? '', 'textures', '.png.mcmeta');

    try {
      return await this.readJson(path);
    } catch (e) {
      return null;
    }
  }

  /** Reads an asset, searching each jar in order and returning the first hit. */
  protected async read(assetPath: string): Promise<Buffer> {
    let lastError: unknown;
    for (const jar of this.jars) {
      try {
        return await jar.read(assetPath);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? new Error(`Asset not found: ${assetPath}`);
  }

  protected async readJson(assetPath: string): Promise<any> {
    return JSON.parse((await this.read(assetPath)).toString());
  }

  async *render(blocks: BlockModel[], options?: RendererOptions) {
    try {
      await this.prepareRenderEnvironment(options);

      for (const block of blocks) {
        yield await render(this, block);
      }
    } finally {
      await this.cleanupRenderEnvironment();
    }
  }

  /**
   * Renders blocks (by name) across a pool of worker processes, yielding each
   * result as it finishes. Rendering is CPU-bound and synchronous, so this
   * parallelizes across cores where the single-threaded {@link render} cannot.
   */
  renderParallel(
    blockNames: string[],
    options: RendererOptions = {},
  ): AsyncGenerator<ParallelRenderResult> {
    return renderPool(
      this.jars.map((jar) => jar.file),
      blockNames,
      options,
      options.concurrency,
    );
  }

  async getModel(blockName: string): Promise<BlockModel> {
    const ref = blockName.includes(':')
      ? blockName
      : `${await this.namespace()}:${blockName}`;

    return this.resolveModel(ref, blockName);
  }

  protected async resolveModel(
    ref: string,
    blockName: string,
  ): Promise<BlockModel> {
    let { parent, ...model } = await this.getModelFile(ref);

    if (parent) {
      // Parent refs follow vanilla resolution (a bare `block/block` means
      // `minecraft:block/block`), so resolve them as-authored rather than in
      // the mod namespace.
      model = deepAssign({}, await this.resolveModel(parent, blockName), model);

      if (!model.parents) {
        model.parents = [];
      }

      model.parents.push(parent);
    }

    return deepAssign(model, { blockName });
  }

  async close() {
    await Promise.all(this.jars.map((jar) => jar.close()));
  }

  async prepareRenderEnvironment(options: RendererOptions = {}) {
    this.renderer = await prepareRenderer(options);
  }

  async cleanupRenderEnvironment() {
    await destroyRenderer(this.renderer!);
    this.renderer = null;
  }

  getRenderer() {
    return this.renderer!;
  }
}

// Resolves a `namespace:path` reference to a jar entry path. A bare reference
// (no namespace) defaults to `minecraft`, matching vanilla asset resolution.
function resolveAssetPath(
  ref: string,
  kind: 'models' | 'textures',
  extension: string,
): string {
  let namespace = 'minecraft';

  const colon = ref.indexOf(':');
  if (colon !== -1) {
    namespace = ref.slice(0, colon);
    ref = ref.slice(colon + 1);
  }

  if (kind === 'models' && ref.indexOf('/') === -1) {
    ref = `block/${ref}`;
  }

  return `assets/${namespace}/${kind}/${ref}${extension}`;
}
