import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Minecraft } from '../minecraft.js';
import { prepareRenderer, render, destroyRenderer } from '../render.js';
import type { Renderer, RendererOptions } from '../utils/types.js';

interface WorkerConfig {
  jarPath: string;
  outDir: string;
  prefix: string;
  options: RendererOptions;
}

type TaskMessage = { name: string } | { close: true };

// headless-gl's native addon self-registers once per process and cannot be
// loaded into a second worker thread, so real parallelism uses separate child
// processes instead. Config arrives via the environment; work arrives over the
// fork IPC channel one block at a time.
const config: WorkerConfig = JSON.parse(process.env.RENDER_CONFIG!);
const { jarPath, outDir, prefix, options } = config;

// One jar handle and one GL-backed renderer per process, reused across every
// block this worker handles.
const minecraft = Minecraft.open(jarPath);
let rendererPromise: Promise<Renderer> | null = null;
const getRenderer = () => (rendererPromise ??= prepareRenderer(options));

process.on('message', async (msg: TaskMessage) => {
  if ('close' in msg) {
    if (rendererPromise) await destroyRenderer(await rendererPromise);
    await minecraft.close();
    process.disconnect();
    return;
  }

  const { name } = msg;
  try {
    const renderer = await getRenderer();
    const block = await minecraft.getModel(name);
    const result = await render(minecraft, block, renderer);

    if (!result.buffer) {
      process.send!({ name, skip: result.skip });
      return;
    }

    await fs.writeFile(
      path.resolve(outDir, `${prefix}${name}.png`),
      result.buffer,
    );
    process.send!({ name, ok: true });
  } catch (err: any) {
    process.send!({ name, error: err?.message || String(err) });
  }
});
