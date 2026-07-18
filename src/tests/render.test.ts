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
  async renderAll() {
    const names = this._pickBlocks(
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
      concurrency: process.env.WORKERS
        ? parseInt(process.env.WORKERS)
        : undefined,
      renderWithoutGui: process.env.RENDER_WITHOUT_GUI === 'true',
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
          path.resolve(
            outDir,
            `${prefix}${res.blockName.replaceAll('/', '_')}.png`,
          ),
          res.buffer!,
        );
        console.log(`${done}/${total} Rendering ${res.blockName} successfully`);
      }
    }
  }

  _pickBlocks(blocks: string[]) {
    const { BLOCK_NAMES } = process.env;

    if (!BLOCK_NAMES) {
      return blocks.filter((name) => {
        if (name.startsWith('template_')) {
          return false;
        }

        if (
          name.endsWith('_x') ||
          name.endsWith('_y') ||
          name.endsWith('_z') ||
          name.endsWith('_rot_0') ||
          name.endsWith('_rot_1') ||
          name.endsWith('_rot_2') ||
          name.endsWith('_rot_3') ||
          name.endsWith('_center') ||
          name.endsWith('_inventory') ||
          name.endsWith('_left') ||
          name.endsWith('_right') ||
          name.endsWith('_unconnected') ||
          name.endsWith('_unpowered') ||
          name.endsWith('_mirrored') ||
          name.endsWith('_mirrored_all') ||
          name.endsWith('_cross') ||
          name.endsWith('_cross_emissive') ||
          name.endsWith('_frame_filled') ||
          name.endsWith('_triggered') ||
          name.endsWith('_crafting') ||
          name.endsWith('_age0') ||
          name.endsWith('_age1') ||
          name.endsWith('_noside') ||
          name.endsWith('_noside_alt') ||
          name.endsWith('_post') ||
          name.endsWith('_side') ||
          name.endsWith('_side_alt') ||
          name.endsWith('_lit') ||
          name.endsWith('_powered') ||
          name.endsWith('_pressed') ||
          name.endsWith('_side_tall') ||
          name.endsWith('_top') ||
          name.endsWith('_inner') ||
          name.endsWith('_outer') ||
          name.endsWith('_cap') ||
          name.endsWith('_cap_alt') ||
          name.endsWith('_post_ends')
        ) {
          return false;
        }

        return true;
      });
    }

    const preferred = BLOCK_NAMES.split(',');

    Logger.info(() => `BLOCK_NAMES flag is enabled. "${BLOCK_NAMES}"`);

    return blocks.filter((block) => preferred.some((name) => name == block));
  }
}
