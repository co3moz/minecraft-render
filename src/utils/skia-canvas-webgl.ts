import {
  Canvas as SkiaCanvas,
  Image,
  loadImage as skiaLoadImage,
} from 'skia-canvas';
//@ts-ignore
import createGLContext from 'gl';

export { Image };

export async function loadImage(src: string | Buffer): Promise<Image> {
  return await skiaLoadImage(src);
}

function syncWebGLToCanvas2D(gl: any, canvas: any) {
  const { width, height } = canvas;
  const ctx = canvas._ctx2d;
  if (!ctx) return;

  const data = ctx.getImageData(0, 0, width, height);
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  // Invert the rows because WebGL coordinates are y-up and Canvas 2D is y-down.
  // Copy whole rows at a time instead of iterating every pixel and channel
  // (~width*4 fewer operations per row) — readPixels + this flip runs on the
  // JS thread for every frame, so the naive triple loop dominated encode time.
  const rowBytes = width * 4;
  const dst = data.data;
  for (let row = 0; row < height; row++) {
    const srcStart = row * rowBytes;
    dst.set(
      pixels.subarray(srcStart, srcStart + rowBytes),
      (height - row - 1) * rowBytes,
    );
  }

  ctx.putImageData(data, 0, 0);
}

export class WebGLCanvas extends SkiaCanvas {
  private __gl__: any = null;
  private _ctx2d: any = null;
  private __contextType__: string | null = null;
  public style: any = {};
  private __attributes__: any = {};

  getContext(type: any = '2d', options?: any): any {
    if (this.__contextType__ && this.__contextType__ !== type) return null;
    if (this.__gl__) return this.__gl__;
    this.__contextType__ = type;

    if (type === 'webgl' || type === 'webgl2') {
      const { width, height } = this;
      this._ctx2d = super.getContext('2d');
      const gl = createGLContext(width, height, options);

      // Temporary fix from headless-gl issues
      const _getUniformLocation = gl.getUniformLocation;
      gl.getUniformLocation = function (program: any, name: string) {
        if (program._uniforms && !/\[\d+\]$/.test(name)) {
          const reg = new RegExp(`${name}\\[\\d+\\]$`);
          for (let i = 0; i < program._uniforms.length; i++) {
            const _name = program._uniforms[i].name;
            if (reg.test(_name)) {
              name = _name;
            }
          }
        }
        return _getUniformLocation.call(this, program, name);
      };

      gl.canvas = this;
      const _texImage2D = gl.texImage2D;
      gl.texImage2D = function (...args: any[]) {
        let pixels = args[args.length - 1];
        if (pixels && pixels._image) pixels = pixels._image;
        if (
          pixels &&
          (typeof pixels.getContext === 'function' ||
            pixels.constructor?.name === 'Canvas' ||
            pixels.constructor?.name === 'WebGLCanvas' ||
            pixels.constructor?.name === 'Image' ||
            pixels.constructor?.name === 'NodeCanvasElement')
        ) {
          let canvasToUse = pixels;
          if (pixels.constructor?.name === 'Image') {
            const tempCanvas = new SkiaCanvas(pixels.width, pixels.height);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(pixels, 0, 0);
            canvasToUse = tempCanvas;
          }

          const ctx2d = canvasToUse.getContext('2d');
          const imageData = ctx2d.getImageData(
            0,
            0,
            canvasToUse.width,
            canvasToUse.height,
          );

          const target = args[0];
          const level = args[1];
          const internalformat = args[2];
          const format = args[3];
          const type = args[4];

          return _texImage2D.call(
            this,
            target,
            level,
            internalformat,
            canvasToUse.width,
            canvasToUse.height,
            0,
            format,
            type,
            new Uint8Array(imageData.data),
          );
        }
        return _texImage2D.apply(this, args);
      };

      this.__gl__ = gl;
      return this.__gl__;
    }

    return super.getContext(type as any);
  }

  toBuffer(format?: string, options?: any): any {
    if (this.__gl__) {
      syncWebGLToCanvas2D(this.__gl__, this);
    }
    // Return standard Buffer synchronously.
    let ext = 'png';
    if (format) {
      if (format.startsWith('image/')) {
        ext = format.split('/')[1];
      } else {
        ext = format;
      }
    }
    return super.toBufferSync(ext as any);
  }

  addEventListener(type: string, listener: any) {
    // Basic mock
  }

  removeEventListener(type: string, listener: any) {
    // Basic mock
  }

  dispatchEvent(event: any) {
    // Basic mock
    return true;
  }

  setAttribute(key: string, value: any) {
    this.__attributes__[key] = value;
  }

  getAttribute(key: string) {
    return this.__attributes__[key];
  }

  removeAttribute(key: string) {
    delete this.__attributes__[key];
  }
}

export function createCanvas(width: number, height: number): WebGLCanvas {
  return new WebGLCanvas(width, height);
}
