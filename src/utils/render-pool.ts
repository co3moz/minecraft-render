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
  jarPath: string,
  blockNames: string[],
  options: RendererOptions = {},
  concurrency = Math.max(1, availableParallelism() - 1),
): AsyncGenerator<ParallelRenderResult> {
  if (blockNames.length === 0) return;

  const poolSize = Math.max(1, Math.min(concurrency, blockNames.length));
  const workerPath = resolveWorker();
  const config = JSON.stringify({ jarPath, options });
  const queue = blockNames.slice();

  const pending: ParallelRenderResult[] = [];
  const workers: ChildProcess[] = [];
  let exited = 0;
  let failure: unknown = null;
  let wake: (() => void) | null = null;

  const signal = () => {
    const resume = wake;
    wake = null;
    resume?.();
  };

  const dispatch = (worker: ChildProcess) => {
    const name = queue.shift();
    worker.send(name === undefined ? { close: true } : { name });
  };

  for (let i = 0; i < poolSize; i++) {
    const worker = fork(workerPath, {
      env: { ...process.env, RENDER_CONFIG: config },
      serialization: 'advanced',
    });

    worker.on('message', (res: ParallelRenderResult) => {
      pending.push(res);
      dispatch(worker);
      signal();
    });
    worker.on('error', (err) => {
      failure ??= err;
      workers.forEach((w) => w.kill());
      signal();
    });
    worker.on('exit', () => {
      exited++;
      signal();
    });

    workers.push(worker);
  }

  for (const worker of workers) dispatch(worker);

  try {
    while (true) {
      while (pending.length) yield pending.shift()!;
      if (failure) throw failure;
      if (exited === workers.length) return;
      await new Promise<void>((resolve) => (wake = resolve));
    }
  } finally {
    // If the consumer stops early (break/throw), make sure no workers linger.
    for (const worker of workers) if (worker.connected) worker.kill();
  }
}
