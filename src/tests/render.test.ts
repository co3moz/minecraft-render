import { Dependency, Skip, Spec } from 'nole';
import { MinecraftTest } from './minecraft.test.js';

import * as path from 'path';
import * as fs from 'fs';
import { BlockModel } from '../utils/types.js';
import { Logger } from '../utils/logger.js';

export class RenderTest {
  @Dependency(MinecraftTest)
  minecraftTest!: MinecraftTest;

  @Spec(180000)
  async renderAll() {
    const blocks = await this.minecraftTest.minecraft.getBlockList();

    const renderCandidates = pickBlocks(blocks);

    for await (const render of this.minecraftTest.minecraft.render(renderCandidates)) {
      if (!render.buffer) {
        console.log('Rendering skipped ' + render.blockName + ' reason: ' + render.skip!);
        continue;
      }

      await writeAsync(`test-data/${process.env.RENDER_FOLDER || ''}${render.blockName}.png`, render.buffer);
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

function pickBlocks(blocks: BlockModel[]) {
  const { BLOCK_NAMES } = process.env;

  if (!BLOCK_NAMES) {
    return blocks;
  }

  const preferred = BLOCK_NAMES.split(',');

  Logger.info(() => `BLOCK_NAMES flag is enabled. "${BLOCK_NAMES}"`)

  return blocks.filter(block => preferred.some(name => name == block.blockName));
}