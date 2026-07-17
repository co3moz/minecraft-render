import { Test } from 'nole';
import { MinecraftTest } from './minecraft.test.js';

import * as path from 'path';
import { fork, type ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
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

    // Rendering is CPU-bound and synchronous (headless-gl draw + readPixels +
    // PNG encode all block the JS thread), so real parallelism needs separate
    // processes (headless-gl's native addon can't be loaded into worker
    // threads). Each worker owns its own jar handle and GL context and writes
    // its PNGs to disk directly, so only block names and small status replies
    // cross the process boundary.
    const config = {
      jarPath: path.resolve(__dirname, '../../test-data/test.jar'),
      outDir: path.resolve(__dirname, '../../test-data'),
      prefix: process.env.RENDER_FOLDER || '',
      options: {
        width: parseInt(process.env.WIDTH || '1000'),
        height: parseInt(process.env.HEIGHT || '1000'),
        distance: parseInt(process.env.DISTANCE || '20'),
        plane: parseInt(process.env.PLANE || '0'),
        animation: process.env.ANIMATION !== 'false',
      },
    };

    const poolSize = Math.max(
      1,
      Math.min(
        parseInt(process.env.WORKERS || '') || availableParallelism() - 1,
        names.length,
      ),
    );

    Logger.info(
      () => `Rendering ${names.length} blocks with ${poolSize} workers`,
    );

    const bootstrap = fileURLToPath(
      new URL('./render.worker.bootstrap.mjs', import.meta.url),
    );
    const queue = names.slice();
    const total = names.length;
    let done = 0;

    await new Promise<void>((resolve, reject) => {
      const workers: ChildProcess[] = [];
      let exited = 0;

      // Hand a worker the next block, or tell it to shut down (dispose its GL
      // context) once the queue is drained. Each worker holds at most one task
      // at a time, so the pool renders `poolSize` blocks in parallel.
      const dispatch = (worker: ChildProcess) => {
        const name = queue.shift();
        worker.send(name === undefined ? { close: true } : { name });
      };

      for (let i = 0; i < poolSize; i++) {
        const worker = fork(bootstrap, {
          env: { ...process.env, RENDER_CONFIG: JSON.stringify(config) },
        });

        worker.on('message', (res: any) => {
          done++;

          if (res.error) {
            console.error(`${done}/${total} ${res.name} error: ${res.error}`);
          } else if (res.skip) {
            console.log(
              `${done}/${total} Rendering skipped ${res.name} reason: ${res.skip}`,
            );
          } else {
            console.log(`${done}/${total} Rendering ${res.name} successfully`);
          }

          dispatch(worker);
        });

        worker.on('error', (err) => {
          workers.forEach((w) => w.kill());
          reject(err);
        });

        worker.on('exit', () => {
          if (++exited === workers.length) resolve();
        });

        workers.push(worker);
      }

      for (const worker of workers) dispatch(worker);
    });
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
