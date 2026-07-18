import { Minecraft } from './minecraft.js';
import { prepareRenderer, render } from './render.js';
import type { Renderer, RendererOptions } from './utils/types.js';

// Entry point for a render worker process spawned by `renderPool`. headless-gl's
// native addon self-registers once per process and cannot be loaded into a
// worker thread, so parallelism uses child processes: each one owns its own jar
// handle and GL context, reused across every block it is handed over IPC.
const { jarPaths, options } = JSON.parse(process.env.RENDER_CONFIG!) as {
  jarPaths: string[];
  options: RendererOptions;
};

const minecraft = Minecraft.open(jarPaths);
let rendererPromise: Promise<Renderer> | null = null;
const getRenderer = () => (rendererPromise ??= prepareRenderer(options));

process.on('message', async (msg: { name: string } | { close: true }) => {
  if ('close' in msg) {
    // Recycled or finished. Exit the process outright — this is the only thing
    // that returns headless-gl's native memory to the OS. `process.disconnect()`
    // just closes the IPC channel and can leave the process alive on native
    // handles, so exit hard; the OS reclaims the GL context, jar fds and all.
    process.exit(0);
  }

  const { name } = msg;
  try {
    const renderer = await getRenderer();
    const block = await minecraft.getModel(name);
    const result = await render(minecraft, block, renderer);
    // The fork channel uses advanced (structured-clone) serialization, so the
    // Buffer is sent as-is and arrives as a Buffer on the other side.
    process.send!(
      result.buffer
        ? { blockName: name, buffer: result.buffer }
        : { blockName: name, skip: result.skip },
    );
  } catch (err: any) {
    process.send!({ blockName: name, error: err?.message || String(err) });
  }
});
