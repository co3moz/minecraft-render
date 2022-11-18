import { Dependency, Spec } from 'nole';
import { Minecraft } from '../minecraft.js';
import { JarTest } from './jar.test.js';

export class MinecraftTest {
  @Dependency(JarTest)
  jarTest!: JarTest;

  minecraft!: Minecraft

  @Spec()
  async init() {
    this.minecraft = Minecraft.open(this.jarTest.jar);
  }

  @Spec()
  async blockModel() {
    (await this.minecraft.getModelFile());
  }
}