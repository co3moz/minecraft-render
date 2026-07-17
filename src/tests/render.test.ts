import { Test } from 'nole';
import { MinecraftTest } from './minecraft.test.js';

import * as path from 'path';
import * as fs from 'fs';
import { BlockModel } from '../utils/types.js';
import { Logger } from '../utils/logger.js';
import { fileURLToPath } from 'url';
import { createPool } from 'generic-pool';
import { render, prepareRenderer, destroyRenderer } from '../render.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class RenderTest extends Test({
  timeout: 600000,
  dependencies: {
    minecraftTest: () => MinecraftTest,
  },
}) {
  minecraftTest!: MinecraftTest;

  async renderAll() {
    const blocks = await this.minecraftTest.minecraft.getBlockList();

    const renderCandidates = pickBlocks(blocks);

    const pool = createPool(
      {
        create: async () => {
          return await prepareRenderer({
            width: parseInt(process.env.WIDTH || '1000'),
            height: parseInt(process.env.HEIGHT || '1000'),
            distance: parseInt(process.env.DISTANCE || '20'),
            plane: parseInt(process.env.PLANE || '0'),
            animation: process.env.ANIMATION !== 'false',
          });
        },
        destroy: async (renderer) => {
          await destroyRenderer(renderer);
        },
      },
      {
        max: 10,
        min: 0,
      },
    );

    const total = renderCandidates.length;
    let current = 0;

    try {
      await Promise.all(
        renderCandidates.map(async (block) => {
          const renderer = await pool.acquire();

          try {
            current++;
            const result = await render(
              this.minecraftTest.minecraft,
              block,
              renderer,
            );

            if (!result.buffer) {
              console.log(
                `${current}/${total} Rendering skipped ${result.blockName} reason: ${result.skip!}`,
              );
              return;
            }

            const filePath = path.resolve(
              __dirname,
              `../../test-data/${process.env.RENDER_FOLDER || ''}${result.blockName}.png`,
            );

            await writeAsync(filePath, result.buffer);

            console.log(
              `${current}/${total} Rendering ${result.blockName} successfully`,
            );
          } catch (err: any) {
            console.error('Error rendering block ' + block.blockName, err);
          } finally {
            await pool.release(renderer);
          }
        }),
      );
    } finally {
      await pool.drain();
      await pool.clear();
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

  Logger.info(() => `BLOCK_NAMES flag is enabled. "${BLOCK_NAMES}"`);

  return blocks.filter((block) =>
    preferred.some((name) => name == block.blockName),
  );
}
