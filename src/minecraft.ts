import { destroyRenderer, prepareRenderer, render } from "./render";
import { Jar } from "./utils/jar";
import type { BlockModel, Renderer } from "./utils/types";
//@ts-ignore
import * as deepAssign from 'assign-deep';

export class Minecraft {
  protected jar: Jar

  protected constructor(public file: string | Jar) {
    if (file instanceof Jar) {
      this.jar = file;
    } else {
      this.jar = Jar.open(file);
    }
  }

  static open(file: string | Jar) {
    return new Minecraft(file);
  }

  async getBlockNameList(): Promise<string[]> {
    return (await this.jar.entries('assets/minecraft/models/block'))
      .filter(entry => entry.name.endsWith(".json"))
      .map(entry => entry.name.slice('assets/minecraft/models/block/'.length, -('.json'.length)))
  }

  async getBlockList(): Promise<BlockModel[]> {
    return await Promise.all((await this.getBlockNameList()).map(block => this.getModel(block)));
  }

  _cache: { [key: string]: any } = {}

  async getModelFile<T = BlockModel>(name = 'block/block'): Promise<T> {
    if (name.startsWith('minecraft:')) {
      name = name.substring('minecraft:'.length);
    }

    if (name.indexOf('/') == -1) {
      name = `block/${name}`;
    }

    const path = `assets/minecraft/models/${name}.json`;

    try {
      if (this._cache[path]) {
        return JSON.parse(JSON.stringify(this._cache[path]));
      }

      this._cache[path] = await this.jar.readJson(path);

      return this._cache[path];
    } catch (e) {
      throw new Error(`Unable to find model file: ${path}`)
    }
  }

  async getTextureFile(name: string = '') {
    name = name ?? '';
    if (name.startsWith('minecraft:')) {
      name = name.substring('minecraft:'.length);
    }

    const path = `assets/minecraft/textures/${name}.png`;

    try {
      return await this.jar.read(path);
    } catch (e) {
      throw new Error(`Unable to find texture file: ${path}`)
    }
  }

  async *render(blocks: BlockModel[]) {
    try {
      await this.prepareRenderEnvironment();

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

  _renderer!: Renderer | null;

  async prepareRenderEnvironment() {
    this._renderer = await prepareRenderer()
  }

  async cleanupRenderEnvironment() {
    await destroyRenderer(this._renderer!);
    this._renderer = null;
  }

}