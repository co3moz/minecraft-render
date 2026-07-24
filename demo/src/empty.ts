// Stub for Node built-ins that only appear in code paths never reached in the
// browser (Minecraft.forMod / renderParallel are dynamically imported and never
// called client-side). Aliased in vite.config.ts so Vite can resolve the
// dynamic-import chunks at build time.
//
// Rollup statically validates named imports, so the specific names those
// Node-only modules pull in must exist here (as no-op undefineds).
export const pipeline: any = undefined;
export const Readable: any = undefined;
export const fork: any = undefined;
export const availableParallelism: any = undefined;
export const fileURLToPath: any = undefined;
export const createWriteStream: any = undefined;
export const existsSync: any = undefined;
export const promises: any = {};
export const resolve: any = undefined;
export default {};
