import { fork, type ChildProcess } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { RendererOptions } from './types.js';

export interface ParallelRenderResult {
  blockName: string;
  buffer?: Buffer;
  skip?: string;
  error?: string;
}

// Under tsx the module URL ends in `.ts` and we must go through the bootstrap
// that re-registers the loader in the forked process; a compiled build forks
// the emitted worker directly.
function resolveWorker(): string {
  const relative = import.meta.url.endsWith('.ts')
    ? '../render.worker.bootstrap.mjs'
    : '../render.worker.js';
  return fileURLToPath(new URL(relative, import.meta.url));
}

/**
 * Renders many blocks across a pool of child processes and yields each result
 * as it completes. Each worker holds one block at a time, so up to
 * `concurrency` blocks render in parallel on separate cores; rendering is
 * synchronous and CPU-bound, so separate processes are what actually parallelize
 * it (headless-gl can't share a GL context or load into worker threads).
 */
export async function* renderPool(
  jarPaths: string[],
  blockNames: string[],
  options: RendererOptions = {},
  concurrency = Math.max(1, availableParallelism() - 1),
): AsyncGenerator<ParallelRenderResult> {
  if (blockNames.length === 0) return;

  const poolSize = Math.max(1, Math.min(concurrency, blockNames.length));
  const workerPath = resolveWorker();
  const config = JSON.stringify({ jarPaths, options });
  const queue = blockNames.slice();

  // headless-gl never returns its native memory to the OS, so a worker that
  // renders thousands of blocks grows without bound. Retire a worker after
  // `recycleEvery` blocks and spawn a fresh one to take over — process exit is
  // the only thing that fully reclaims the memory.
  const recycleEvery = Number(process.env.RECYCLE_EVERY) || 256;

  const pending: ParallelRenderResult[] = [];
  const live = new Set<ChildProcess>();
  let failure: unknown = null;
  let wake: (() => void) | null = null;

  const signal = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  const spawn = () => {
    const worker = fork(workerPath, {
      env: { ...process.env, RENDER_CONFIG: config },
      serialization: 'advanced',
    });
    live.add(worker);
    let processed = 0;

    const next = () => {
      // Retire (don't take another block) once this worker hits its quota; a
      // replacement is spawned when it exits. The block stays on the queue.
      if (processed >= recycleEvery && queue.length > 0) {
        worker.send({ close: true });
        return;
      }
      const name = queue.shift();
      if (name === undefined) {
        worker.send({ close: true });
        return;
      }
      processed++;
      worker.send({ name });
    };

    worker.on('message', (res: ParallelRenderResult) => {
      pending.push(res);
      next();
      signal();
    });
    worker.on('error', (err) => {
      failure ??= err;
      for (const w of live) w.kill();
      signal();
    });
    worker.on('exit', () => {
      live.delete(worker);
      if (queue.length > 0 && !failure) spawn();
      signal();
    });

    next();
  };

  for (let i = 0; i < poolSize; i++) spawn();

  try {
    while (true) {
      while (pending.length) yield pending.shift()!;
      if (failure) throw failure;
      if (live.size === 0) return;
      await new Promise<void>((resolve) => (wake = resolve));
    }
  } finally {
    // If the consumer stops early (break/throw), make sure no workers linger.
    for (const worker of live) if (worker.connected) worker.kill();
  }
}
