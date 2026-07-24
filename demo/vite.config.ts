import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const stub = fileURLToPath(new URL('./src/empty.ts', import.meta.url));

export default defineConfig({
  // Served from `/<repo>/` on GitHub Pages (set by CI), `/` everywhere else.
  base: process.env.BASE_PATH || '/',
  // The linked library ships its own `browser` field + `exports` conditions;
  // let Vite process it through the normal pipeline (rather than esbuild
  // pre-bundling) so those swaps are honored.
  optimizeDeps: { exclude: ['minecraft-render'] },
  resolve: {
    // `Minecraft.forMod` and `renderParallel` are Node-only and dynamically
    // imported — never executed in the browser, but Vite still resolves the
    // chunk graph at build time. Point the Node built-ins at an empty stub.
    // Exact (`$`-anchored) matches so `node:stream` doesn't swallow
    // `node:stream/promises`.
    alias: [
      { find: /^node:fs$/, replacement: stub },
      { find: /^node:path$/, replacement: stub },
      { find: /^node:os$/, replacement: stub },
      { find: /^node:url$/, replacement: stub },
      { find: /^node:child_process$/, replacement: stub },
      { find: /^node:stream$/, replacement: stub },
      { find: /^node:stream\/promises$/, replacement: stub },
      { find: /^node:stream\/web$/, replacement: stub },
    ],
  },
});
