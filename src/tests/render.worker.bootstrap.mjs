// Worker entry point. nole registers the tsx ESM loader programmatically in the
// main thread (via `tsx/esm/api`), which does not carry over to worker threads,
// so a plain-JS bootstrap registers it here before importing the .ts worker.
import { register } from 'tsx/esm/api';

register();

await import('./render.worker.ts');
