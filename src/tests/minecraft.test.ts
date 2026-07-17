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
    await this.minecraft.getModelFile();
  }
}
