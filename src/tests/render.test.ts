import { Dependency, Spec } from 'nole';
import { MinecraftTest } from './minecraft.test';

import * as path from 'path';
import * as fs from 'fs';


export class RenderTest {
  @Dependency(MinecraftTest)
  minecraftTest!: MinecraftTest;

  @Spec(180000)
  async renderAll() {
    const blocks = await this.minecraftTest.minecraft.getBlockList();

    for await (const render of this.minecraftTest.minecraft.render(blocks)) {
      if (!render.buffer) {
        console.log('Rendering skipped ' + render.blockName + ' reason: ' + render.skip!);
        continue;
      }

      const filePath = path.resolve(__dirname, `../../test-data/${render.blockName}.png`);

      await writeAsync(filePath, render.buffer);
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