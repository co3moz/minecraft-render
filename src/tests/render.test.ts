import { Dependency, Spec } from 'nole';
import { MinecraftTest } from './minecraft.test';

import * as path from 'path';
import * as fs from 'fs';


export class RenderTest {
  @Dependency(MinecraftTest)
  minecraftTest!: MinecraftTest;

  @Spec(180000)
  async renderAll() {
    const blocks = await Promise.all(
      (await this.minecraftTest.minecraft.getBlockList()).map(block => {
        const blockName = block.name.slice('assets/minecraft/models/block/'.length, -('.json'.length));
        return this.minecraftTest.minecraft.getModel(blockName)
      }));

    const testBlocks = blocks;
    // const testBlocks = blocks.slice(0, 300);
    // let testBlocks = blocks.filter(x => x.blockName! === 'cactus');
    // testBlocks = [...testBlocks[0].elements!.map((element, i) => {
    //   const u = JSON.parse(JSON.stringify(testBlocks[0]));
    //   u.blockName += '_el_' + i;
    //   u.elements = [element];
    //   return u;
    // }), testBlocks[0]
    // ];   


    // let testBlocks = blocks.filter(x => x.blockName! === 'lectern' || x.blockName == 'diamond_ore');
    // let testBlocks = blocks.filter(x => x.blockName! === 'acacia_log');

    await this.minecraftTest.minecraft.prepareRenderEnvironment();

    try {
      for await (const render of this.minecraftTest.minecraft.render(testBlocks)) {
        if (!render.buffer) {
          console.log('Rendering skipped ' + render.blockName + ' reason: ' + render.skip!);
          continue;
        }

        const filePath = path.resolve(__dirname, `../../test-data/${render.blockName}.png`);

        await writeAsync(filePath, render.buffer);
      }
    } finally {
      await this.minecraftTest.minecraft.cleanupRenderEnvironment();
    }
  }
}

function writeAsync(filePath: string, buffer: Buffer) {
  return new Promise<void>((resolve, reject) => {
    fs.writeFile(filePath, buffer, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}