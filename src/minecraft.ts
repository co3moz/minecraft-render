//@ts-ignore
import * as deepAssign from "assign-deep";
import { destroyRenderer, prepareRenderer, render } from "./render";
import { Jar } from "./utils/jar";
import type {
  AnimationMeta,
  BlockModel,
  Renderer,
  RendererOptions
} from "./utils/types";

export class Minecraft {
  protected jar: Jar;
  protected renderer!: Renderer | null;
  protected _cache: { [key: string]: any } = {};

  protected constructor(
    public file: string | Jar,
    protected readonly defaultNamespace = "minecraft"
  ) {
    if (file instanceof Jar) {
      this.jar = file;
    } else {
      this.jar = Jar.open(file);
    }
  }

  protected id(name: string) {
    if (name.includes(":")) {
      const [namespace, id] = name.split(":");
      return { namespace, id };
    } else {
      return { namespace: "minecraft", id: name };
    }
  }

  static open(file: string | Jar, namespace?: string) {
    return new Minecraft(file, namespace);
  }

  async getBlockNameList(namespace = this.defaultNamespace): Promise<string[]> {
    return (await this.jar.entries(`assets/${namespace}/models/block`))
      .filter((entry) => entry.name.endsWith(".json"))
      .map((entry) => namespace + ':' +
        entry.name.slice(
          `assets/${namespace}/models/block/`.length,
          -".json".length
        )
      );
  }

  async getBlockList(namespace = this.defaultNamespace): Promise<BlockModel[]> {
    return await Promise.all(
      (
        await this.getBlockNameList(namespace)
      ).map((block) => this.getModel(block))
    );
  }

  async getModelFile<T = BlockModel>(name = "block/block"): Promise<T> {
    let { namespace, id } = this.id(name);

    if (id.indexOf("/") == -1) {
      id = `block/${id}`;
    }

    const path = `assets/${namespace}/models/${id}.json`;

    try {
      if (this._cache[path]) {
        return JSON.parse(JSON.stringify(this._cache[path]));
      }

      this._cache[path] = await this.jar.readJson(path);

      return this._cache[path];
    } catch (e) {
      throw new Error(`Unable to find model file: ${path}`);
    }
  }

  async getTextureFile(name: string = "") {
    const { namespace, id } = this.id(name);

    const path = `assets/${namespace}/textures/${id}.png`;

    try {
      return await this.jar.read(path);
    } catch (e) {
      throw new Error(`Unable to find texture file: ${path}`);
    }
  }

  async getTextureMetadata(name: string = ""): Promise<AnimationMeta | null> {
    const { namespace, id } = this.id(name);

    const path = `assets/${namespace}/textures/${name}.png.mcmeta`;

    try {
      return await this.jar.readJson(path);
    } catch (e) {
      return null;
    }
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

  async getModel(blockName: string): Promise<BlockModel> {
    let { parent, ...model } = await this.getModelFile(blockName);

    if (parent) {
      model = deepAssign({}, await this.getModel(parent), model);

      if (!model.parents) {
        model.parents = [];
      }

      model.parents.push(parent);
    }

    return deepAssign(model, { blockName });
  }

  async close() {
    await this.jar.close();
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
