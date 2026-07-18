import * as fs from 'node:fs';
import * as path from 'node:path';
import { availableParallelism } from 'node:os';
import { destroyRenderer, prepareRenderer, render } from './render.js';
import { Jar } from './utils/jar.js';
import {
  renderPool,
  type ParallelRenderResult,
} from './utils/render-pool.js';
import { inspectJar, type JarInfo } from './utils/mod-info.js';
import {
  downloadMinecraftJar,
  resolveMinecraftVersion,
} from './utils/vanilla-download.js';
import type {
  AnimationMeta,
  BlockModel,
  Renderer,
  RendererOptions,
} from './utils/types.js';
//@ts-ignore
import deepAssign from 'assign-deep';

export interface ForModOptions {
  /** Directory to cache downloaded vanilla jars in. Defaults to the cwd. */
  cacheDir?: string;
  /** Explicit vanilla jar to use instead of resolving/downloading one. */
  minecraftJar?: string;
  /** Set false to never download; throws if the vanilla jar is missing. */
  download?: boolean;
  /** Called with progress notes (version resolution, download start). */
  onProgress?: (message: string) => void;
}

export type MinecraftSource = string | Jar;

export class Minecraft {
  protected jars: Jar[];
  protected renderer!: Renderer | null;
  protected _cache: { [key: string]: any } = {};
  protected _namespace: string | null = null;
  protected _namespaces: Set<string> | null = null;
  protected _dependencies: Record<string, string> | null = null;

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

  /**
   * Opens a mod jar together with the vanilla jar it depends on. Inspects the
   * mod's loader manifest for its required Minecraft version and, unless an
   * explicit `minecraftJar` is given, resolves that version against Mojang's
   * manifest and downloads it into `cacheDir` if it isn't already there.
   */
  static async forMod(
    modSource: MinecraftSource,
    options: ForModOptions = {},
  ): Promise<Minecraft> {
    const { cacheDir = process.cwd(), download = true, onProgress } = options;
    const note = (message: string) => onProgress?.(message);

    const modJar = modSource instanceof Jar ? modSource : Jar.open(modSource);
    const info: JarInfo = await inspectJar(modJar);
    const sources: MinecraftSource[] = [modJar];

    let minecraftJar = options.minecraftJar;

    if (!minecraftJar && info.loader !== 'vanilla' && info.minecraft) {
      note(`Mod requires Minecraft "${info.minecraft}"; resolving…`);
      const version = await resolveMinecraftVersion(info.minecraft);
      if (!version) {
        throw new Error(
          `Could not resolve Minecraft version "${info.minecraft}" from the ` +
            `Mojang manifest. Pass \`minecraftJar\` explicitly.`,
        );
      }

      minecraftJar = path.resolve(cacheDir, `minecraft-${version.id}.jar`);
      if (!fs.existsSync(minecraftJar)) {
        if (!download) {
          throw new Error(
            `Minecraft ${version.id} jar not found at ${minecraftJar} and ` +
              `download is disabled.`,
          );
        }
        note(`Downloading Minecraft ${version.id}…`);
        await fs.promises.mkdir(cacheDir, { recursive: true });
        await downloadMinecraftJar(version, minecraftJar);
      }
    }

    if (minecraftJar) sources.push(minecraftJar);

    return new Minecraft(sources);
  }

  /** Identifies this jar's loader and Minecraft-version requirement. */
  inspect(): Promise<JarInfo> {
    return inspectJar(this.jars[0]);
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
      throw new Error(await this.missingAssetMessage(name, `model ${path}`));
    }
  }

  async getTextureFile(name: string = '') {
    const path = resolveAssetPath(name ?? '', 'textures', '.png');

    try {
      return await this.read(path);
    } catch (e) {
      throw new Error(await this.missingAssetMessage(name, `texture ${path}`));
    }
  }

  /** The set of asset namespaces present across all loaded jars. */
  async loadedNamespaces(): Promise<Set<string>> {
    if (this._namespaces) return this._namespaces;

    const set = new Set<string>();
    for (const jar of this.jars) {
      for (const entry of await jar.entries('assets/')) {
        const match = /^assets\/([^/]+)\//.exec(entry.name);
        if (match) set.add(match[1]);
      }
    }

    return (this._namespaces = set);
  }

  /** The primary jar's declared dependency ranges (mod id → version range). */
  protected async dependencies(): Promise<Record<string, string>> {
    if (this._dependencies) return this._dependencies;
    const info = await inspectJar(this.jars[0]);
    return (this._dependencies = info.dependencies ?? {});
  }

  // Builds an actionable error when an asset can't be resolved. If its namespace
  // isn't loaded at all, the reference belongs to another mod — suggest the jar
  // to add (with the version the mod declares, if any) rather than a bare path.
  protected async missingAssetMessage(
    ref: string,
    label: string,
  ): Promise<string> {
    const colon = ref.indexOf(':');
    const namespace = colon === -1 ? 'minecraft' : ref.slice(0, colon);

    if ((await this.loadedNamespaces()).has(namespace)) {
      return `Unable to find ${label}`;
    }

    const range = (await this.dependencies())[namespace];
    const version = range?.match(/\d[\w.-]*/)?.[0];
    const suggestion = version ? `${namespace}.${version}.jar` : `${namespace}.jar`;
    const declared = range ? ` (this mod depends on "${namespace}" ${range})` : '';

    return (
      `Namespace "${namespace}" is not loaded${declared}; ` +
      `"${ref}" cannot be resolved. Add its jar with \`--merge ${suggestion}\`.`
    );
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
  async *renderParallel(
    blockNames: string[],
    options: RendererOptions = {},
  ): AsyncGenerator<ParallelRenderResult> {
    const concurrency =
      options.concurrency ?? Math.max(1, availableParallelism() - 1);

    // A single worker gains nothing from a child process — render inline in
    // this process (reusing the already-open jars and one renderer) and skip
    // the fork + loader startup overhead.
    if (concurrency <= 1) {
      yield* this.renderInline(blockNames, options);
      return;
    }

    yield* renderPool(
      this.jars.map((jar) => jar.file),
      blockNames,
      options,
      concurrency,
    );
  }

  protected async *renderInline(
    blockNames: string[],
    options: RendererOptions,
  ): AsyncGenerator<ParallelRenderResult> {
    // headless-gl accumulates native memory across texture/context churn and
    // does not release it on GC or dispose, so a long-lived context leaks and
    // each render gets slower. Periodically tear the GL context down and
    // rebuild it (also resetting the reuse cache) to keep memory and speed flat.
    const recycleEvery = Number(process.env.RECYCLE_EVERY) || 128;

    try {
      await this.prepareRenderEnvironment(options);
      let sinceRecycle = 0;

      for (const blockName of blockNames) {
        try {
          const block = await this.getModel(blockName);
          const result = await render(this, block);
          yield result.buffer
            ? { blockName, buffer: result.buffer }
            : { blockName, skip: result.skip };
        } catch (err: any) {
          yield { blockName, error: err?.message || String(err) };
        }

        if (++sinceRecycle >= recycleEvery) {
          await this.cleanupRenderEnvironment(true);
          await this.prepareRenderEnvironment(options);
          sinceRecycle = 0;
        }
      }
    } finally {
      await this.cleanupRenderEnvironment();
    }
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

  async cleanupRenderEnvironment(immediate = false) {
    await destroyRenderer(this.renderer!, immediate);
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
