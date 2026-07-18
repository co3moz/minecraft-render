// Dev-only worker entry. When the library runs from source under tsx (tests,
// ts-node-style dev), the parent registers tsx's ESM loader only in its own
// thread; a forked process starts fresh, so this plain-JS bootstrap registers
// tsx before importing the TypeScript worker. In a compiled build `renderPool`
// forks `render.worker.js` directly and this file is never used.
import { register } from 'tsx/esm/api';

register();

await import('./render.worker.ts');
