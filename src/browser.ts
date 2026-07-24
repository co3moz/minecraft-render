// Browser entry point. Same surface as `index.ts` minus the Node-only helpers
// (`renderPool`, vanilla-jar download) that pull in `child_process`/`fs`. The
// package's `exports` map resolves consumers here under the `browser`
// condition, and the `browser` field swaps the platform + jar internals for
// their `*.browser` variants.
export {
  Minecraft,
  type MinecraftSource,
  type ForModOptions,
} from './minecraft.js';
export { Jar } from './utils/jar.js';
export { Logger } from './utils/logger.js';
export { inspectJar, type JarInfo, type JarLoader } from './utils/mod-info.js';
export {
  prepareRenderer,
  destroyRenderer,
  render,
  buildBlockMeshes,
} from './render.js';
export {
  createBlockPreview,
  type BlockPreview,
  type BlockPreviewOptions,
} from './preview.browser.js';
export * from './utils/types.js';
