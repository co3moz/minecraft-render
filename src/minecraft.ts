import { destroyRenderer, prepareRenderer, render } from './render.js';
import { Jar } from './utils/jar.js';
import type { AnimationMeta, BlockModel, Renderer, RendererOptions } from './utils/types.js';
import merge from 'lodash/merge.js';

export class Minecraft {
  protected jar: Jar
  protected renderer!: Renderer | null;
  protected _cache: { [key: string]: any } = {};

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
      .map(entry => entry.name.slice('assets/minecraft/models/block/'.length, -('.json'.length)));
  }

  async getBlockList(): Promise<BlockModel[]> {
    return await Promise.all((await this.getBlockNameList()).map(block => this.getModel(block)));
  }

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
      throw new Error(`Unable to find model file: ${path}`);
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
      throw new Error(`Unable to find texture file: ${path}`);
    }
  }


  async getTextureMetadata(name: string = ''): Promise<AnimationMeta | null> {
    name = name ?? '';
    if (name.startsWith('minecraft:')) {
      name = name.substring('minecraft:'.length);
    }

    const path = `assets/minecraft/textures/${name}.png.mcmeta`;

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
      model = merge({}, await this.getModel(parent), model);

      if (!model.parents) {
        model.parents = [];
      }

      model.parents.push(parent);
    }

    return merge(model, { blockName });
  }

  async close() {
    await this.jar.close();
  }

  async prepareRenderEnvironment(options: RendererOptions = {}) {
    this.renderer = await prepareRenderer(options)
  }

  async cleanupRenderEnvironment() {
    if (!this.renderer) return;
    await destroyRenderer(this.renderer);
    this.renderer = null;
  }

  getRenderer() {
    return this.renderer!;
  }
}