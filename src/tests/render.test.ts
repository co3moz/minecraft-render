import { Test } from 'nole';
import { MinecraftTest } from './minecraft.test.js';

import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/logger.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class RenderTest extends Test({
  timeout: 600000,
  dependencies: {
    minecraftTest: () => MinecraftTest,
  },
}) {
  minecraftTest!: MinecraftTest;

  async renderAll() {
    const names = pickBlocks(
      await this.minecraftTest.minecraft.getBlockNameList(),
    );

    const outDir = path.resolve(__dirname, '../../test-data');
    const prefix = process.env.RENDER_FOLDER || '';
    const options = {
      width: parseInt(process.env.WIDTH || '1000'),
      height: parseInt(process.env.HEIGHT || '1000'),
      distance: parseInt(process.env.DISTANCE || '20'),
      plane: parseInt(process.env.PLANE || '0'),
      animation: process.env.ANIMATION !== 'false',
      concurrency: process.env.WORKERS ? parseInt(process.env.WORKERS) : undefined,
    };

    const total = names.length;
    let done = 0;

    // The library fans the render out across worker processes; the test just
    // consumes results as they arrive and writes each PNG to disk.
    for await (const res of this.minecraftTest.minecraft.renderParallel(
      names,
      options,
    )) {
      done++;

      if (res.error) {
        console.error(`${done}/${total} ${res.blockName} error: ${res.error}`);
      } else if (res.skip) {
        console.log(
          `${done}/${total} Rendering skipped ${res.blockName} reason: ${res.skip}`,
        );
      } else {
        await fs.writeFile(
          path.resolve(outDir, `${prefix}${res.blockName}.png`),
          res.buffer!,
        );
        console.log(
          `${done}/${total} Rendering ${res.blockName} successfully`,
        );
      }
    }
  }
}

function pickBlocks(blocks: string[]) {
  const { BLOCK_NAMES } = process.env;

  if (!BLOCK_NAMES) {
    return blocks;
  }

  const preferred = BLOCK_NAMES.split(',');

  Logger.info(() => `BLOCK_NAMES flag is enabled. "${BLOCK_NAMES}"`);

  return blocks.filter((block) => preferred.some((name) => name == block));
}
