# minecraft-render · browser demo

A [Vite](https://vitejs.dev/) app that renders Minecraft blocks **entirely in the
browser** — drag & drop a `.jar`, and blocks are rendered on your GPU using the
same renderer that powers the `minecraft-render` Node library.

## How it reuses the library

The library core (three.js scene setup, model resolution, UV baking, animation
scheduling) is platform-agnostic. Everything host-specific is funnelled through
two small modules that have a Node and a browser variant:

| Concern           | Node (`*.ts`)                     | Browser (`*.browser.ts`)          |
| ----------------- | --------------------------------- | --------------------------------- |
| WebGL / 2D canvas | `skia-canvas` + headless `gl`     | real `<canvas>` + `OffscreenCanvas` |
| Reading the jar   | `node-stream-zip` (from disk)     | `fflate` (from bytes in memory)   |

The package's [`exports`](../package.json) map resolves browser consumers to the
`browser` entry, and its `browser` field swaps `platform.js` → `platform.browser.js`
and `jar.js` → `jar.browser.js` at bundle time. So the demo just does:

```ts
import { Minecraft, Jar, render, createBlockPreview } from 'minecraft-render';

const jar = await Jar.fromBlob(file); // browser-only helper
const mc = Minecraft.open([modJar, vanillaJar]);

// Still thumbnails — bake a block to PNG bytes and show as an <img>.
await mc.prepareRenderEnvironment({ width: 128, height: 128 });
const result = await render(mc, await mc.getModel('brass_encased_cogwheel'));
// result.buffer is PNG bytes

// Live, rotatable preview on a <canvas> — drag to orbit, wheel to zoom.
const preview = await createBlockPreview(canvas, mc, model, { autoRotate: true });
preview.setAutoRotate(false);
preview.dispose();
```

## Running

The demo consumes the library via `file:..`, which resolves to its built
`dist/` (git-ignored), so build the library once first:

```bash
# from the repo root
npm install && npm run build

# then, in this folder
cd demo
npm install
npm run dev
```

Then open the printed URL and drop a jar. Drop a mod jar **together with the
matching vanilla `minecraft.jar`** so parent models and textures resolve; blocks
whose assets can't be found are shown as skipped with the reason.

- **Thumbnails render on demand** — each block bakes to a 256 px still as its
  card scrolls into view. **Hover** a card to spin it live in 3D.
- **Click any block** for a full rotatable preview: drag to rotate, scroll to
  zoom, toggle **Spin**. Its **Download rendered** button opens the export
  screen for that block.
- **Render all → download** exports every listed (filtered) block from the
  default inventory pose (spin is ignored). The export dialog shows a **live
  example** of the first block that updates as you change resolution, camera
  (orthographic/perspective), camera distance, or **light angle**. One block
  downloads as `name.png`; many are bundled into a single `renders.zip`.

> `Minecraft.forMod` (auto-downloads the vanilla jar) and `renderParallel`
> (worker processes) are Node-only and not available in the browser build.
