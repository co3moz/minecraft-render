import { Test } from 'nole';
import { Minecraft } from '../minecraft.js';
import { JarTest } from './jar.test.js';

export class MinecraftTest extends Test({
  dependencies: {
    jarTest: () => JarTest,
  },
}) {
  minecraft!: Minecraft;

  async init() {
    this.minecraft = Minecraft.open(this.jarTest.jar);
  }

  async blockModel() {
    // `block/cube` exists in every JSON-model version; `block/block` (the
    // default) only since 1.9.
    await this.minecraft.getModelFile('block/cube');
  }
}
