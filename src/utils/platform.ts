// Node platform bindings for the renderer.
//
// Everything the render pipeline needs from the host environment — the WebGL
// render target, the 2D scratch canvas used to bake textures, image decoding
// and GL context teardown — is funnelled through this module. A parallel
// `platform.browser.ts` provides the same surface backed by the browser's own
// canvas/WebGL, and the package's `browser` field swaps the two at bundle time
// so the render logic in `render.ts` stays platform-agnostic.
import { Canvas as SkiaCanvas } from 'skia-canvas';
import { createCanvas, loadImage as skiaLoadImage } from './skia-canvas-webgl.js';
import type { RenderCanvas } from './types.js';

/** The WebGL-backed canvas three.js renders into. */
export function createRenderCanvas(width: number, height: number): RenderCanvas {
  return createCanvas(width, height) as unknown as RenderCanvas;
}

/** A 2D canvas used to bake a face's texture before it becomes a THREE.Texture. */
export function createTextureCanvas(width: number, height: number): any {
  return new SkiaCanvas(width, height);
}

/** Decodes PNG bytes (or a path) into a drawable image with width/height. */
export function loadImage(src: any): Promise<any> {
  return skiaLoadImage(src);
}

/** Releases the native GL context backing the render canvas. */
export function destroyRenderContext(canvas: RenderCanvas): void {
  (canvas as any).__gl__
    ?.getExtension('STACKGL_destroy_context')
    ?.destroy();
}
