import { Test } from "nole";
import { Minecraft } from "../minecraft";
import { JarTest } from "./jar.test";

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
