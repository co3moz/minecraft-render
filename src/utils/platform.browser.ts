// Browser platform bindings for the renderer — the counterpart to
// `platform.ts`. Instead of headless-gl + skia-canvas this uses the browser's
// own `<canvas>`/WebGL and `createImageBitmap`, so the exact same render logic
// in `render.ts` runs on the GPU of whoever opens the page. The package's
// `browser` field points bundlers (Vite, webpack, esbuild) here.
import { Buffer } from 'buffer';
import type { RenderCanvas } from './types.js';

/**
 * A real `<canvas>` three.js renders into. Two tweaks make it behave like the
 * Node WebGLCanvas the pipeline expects:
 *  - `getContext` forces `preserveDrawingBuffer` so the frame is still readable
 *    when `toBuffer` runs synchronously right after `renderer.render`.
 *  - `toBuffer` returns PNG bytes synchronously via `toDataURL` (the browser
 *    already hands back a top-left-origin image, so no manual y-flip is needed).
 */
export function createRenderCanvas(width: number, height: number): RenderCanvas {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const nativeGetContext = canvas.getContext.bind(canvas);
  (canvas as any).getContext = (type: string, options?: any) => {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      const gl = nativeGetContext(type as any, {
        ...(options || {}),
        preserveDrawingBuffer: true,
      });
      (canvas as any).__gl__ = gl;
      return gl;
    }
    return nativeGetContext(type as any, options);
  };

  (canvas as any).toBuffer = (_format?: string): Buffer => {
    const url = canvas.toDataURL('image/png');
    const base64 = url.slice(url.indexOf(',') + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return Buffer.from(bytes);
  };

  return canvas as unknown as RenderCanvas;
}

/** A 2D canvas used to bake a face's texture. OffscreenCanvas works as a
 * THREE.Texture source and keeps the work off the DOM. */
export function createTextureCanvas(width: number, height: number): any {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Decodes PNG bytes into an ImageBitmap (drawable, has width/height). */
export async function loadImage(src: Uint8Array | ArrayBuffer | Blob | string): Promise<any> {
  let blob: Blob;
  if (typeof src === 'string') {
    blob = await (await fetch(src)).blob();
  } else if (src instanceof Blob) {
    blob = src;
  } else {
    blob = new Blob([src as ArrayBuffer]);
  }
  return await createImageBitmap(blob);
}

/** Best-effort release of the WebGL context so the browser can reclaim it. */
export function destroyRenderContext(canvas: RenderCanvas): void {
  try {
    (canvas as any).__gl__
      ?.getExtension('WEBGL_lose_context')
      ?.loseContext();
  } catch {
    // Context teardown is best-effort; ignore if unsupported.
  }
}
