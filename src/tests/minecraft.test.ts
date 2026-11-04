import { skipTest, Test } from 'nole';
import { deepStrictEqual } from 'node:assert';
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

  async parentOverridesDoNotLeak() {
    // Resolving a block that overrides its parent's inventory pose (stairs)
    // must not change the pose of blocks resolved after it. It used to: the
    // first read of block/block was handed out uncopied and the stair's
    // display.gui was merged into it, rotating every later cube by 90°.
    const names = await this.minecraft.getBlockNameList();
    if (!names.includes('oak_stairs') || !names.includes('stone')) {
      skipTest('oak_stairs / stone models not in this jar');
    }

    const fresh = Minecraft.open(this.jarTest.jar);
    const expected = (await fresh.getModel('stone')).display?.gui;

    const reused = Minecraft.open(this.jarTest.jar);
    await reused.getModel('oak_stairs');
    const actual = (await reused.getModel('stone')).display?.gui;

    deepStrictEqual(actual, expected);
  }
}
