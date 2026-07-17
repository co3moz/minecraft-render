import * as THREE from 'three';
import { Canvas as SkiaCanvas } from 'skia-canvas';
import type {
  BlockModel,
  BlockSides,
  Element,
  Face,
  Renderer,
  RendererOptions,
} from './utils/types.js';
import type { Minecraft } from './minecraft.js';
import { distance, invert, mul, size } from './utils/vector-math.js';
import { Logger } from './utils/logger.js';
import {
  createCanvas,
  loadImage,
  WebGLCanvas,
} from './utils/skia-canvas-webgl.js';
import { makeAnimatedPNG } from './utils/apng.js';

const MATERIAL_FACE_ORDER = [
  'east',
  'west',
  'up',
  'down',
  'south',
  'north',
] as const;

export async function prepareRenderer({
  width = 1000,
  height = 1000,
  distance = 20,
  plane = 0,
  animation = true,
}: RendererOptions): Promise<Renderer> {
  const scene = new THREE.Scene();

  const canvas: WebGLCanvas = createCanvas(width, height);

  Logger.debug(
    () =>
      `prepareRenderer(width=${width}, height=${height}, distance=${distance})`,
  );

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    logarithmicDepthBuffer: true,
  });

  Logger.trace(() => `WebGL initialized`);

  renderer.sortObjects = false;

  const aspect = width / height;
  const camera = new THREE.OrthographicCamera(
    -distance * aspect,
    distance * aspect,
    distance,
    -distance,
    0.01,
    20000,
  );

  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(-15, 30, -25); // cube directions x => negative:bottom right, y => positive:top, z => negative:bottom left
  scene.add(light);

  Logger.trace(() => `Light added to scene`);

  if (plane) {
    const origin = new THREE.Vector3(0, 0, 0);
    const length = 10;
    scene.add(
      new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0),
        origin,
        length,
        0xff0000,
      ),
    );
    scene.add(
      new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        origin,
        length,
        0x00ff00,
      ),
    );
    scene.add(
      new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, 1),
        origin,
        length,
        0x0000ff,
      ),
    );

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 3);
    const helper = new THREE.PlaneHelper(plane, 30, 0xffff00);
    scene.add(helper);

    Logger.debug(() => `Plane added to scene`);
  }

  return {
    scene,
    renderer,
    canvas,
    camera,
    light,
    textureCache: {},
    animatedCache: {},
    options: { width, height, distance, plane, animation },
  };
}

export async function destroyRenderer(renderer: Renderer) {
  Logger.debug(() => `Renderer destroy in progress...`);

  await new Promise((resolve) => setTimeout(resolve, 500));
  renderer.renderer.info.reset();
  (renderer.canvas as any).__gl__
    .getExtension('STACKGL_destroy_context')
    .destroy();

  Logger.debug(() => `Renderer destroyed`);
}

export async function render(
  minecraft: Minecraft,
  block: BlockModel,
  customRenderer?: Renderer,
): Promise<BlockModel & { buffer: Buffer; skip?: string }> {
  const activeRenderer = customRenderer ?? minecraft.getRenderer()!;
  const { canvas, renderer, scene, camera, options } = activeRenderer;
  const resultBlock: BlockModel & { buffer: Buffer; skip?: string } =
    block as any;

  const gui = block.display?.gui;

  if (!gui || !block.elements || !block.textures) {
    resultBlock.skip = !gui
      ? 'no gui'
      : !block.elements
        ? 'no element'
        : 'no texture';
    return resultBlock;
  }

  Logger.trace(() => `Started rendering ${resultBlock.blockName}`);

  camera.zoom = 1.0 / distance(gui.scale);

  Logger.trace(() => `Camera zoom = ${camera.zoom}`);

  if (typeof block.animationCurrentTick == 'undefined') {
    block.animationCurrentTick = 0;
  }

  const buffers = [];
  const clean: THREE.Mesh[] = [];

  try {
    do {
      Logger.trace(() => `Frame[${block.animationCurrentTick}] started`);

      clean.length = 0;
      let i = 0;

      Logger.trace(() => `Element count = ${block.elements!.length}`);

      for (const element of block.elements!) {
        Logger.trace(() => `Element[${i}] started rendering`);
        element.calculatedSize = size(element.from!, element.to!);

        Logger.trace(
          () => `Element[${i}] geometry = ${element.calculatedSize!.join(',')}`,
        );

        const geometry = new THREE.BoxGeometry(
          ...element.calculatedSize,
          1,
          1,
          1,
        );
        const cube = new THREE.Mesh(
          geometry,
          await constructBlockMaterial(
            minecraft,
            block,
            element,
            activeRenderer,
          ),
        );

        cube.position.set(0, 0, 0);
        cube.position.add(new THREE.Vector3(...element.from!));
        cube.position.add(new THREE.Vector3(...element.to!));
        cube.position.multiplyScalar(0.5);
        cube.position.add(new THREE.Vector3(-8, -8, -8));

        Logger.trace(
          () =>
            `Element[${i}] position set to ${cube.position.toArray().join(',')}`,
        );

        if (element.rotation) {
          const origin = mul(element.rotation.origin!, -0.0625);
          cube.applyMatrix4(
            new THREE.Matrix4().makeTranslation(...invert(origin)),
          );

          if (element.rotation.axis == 'y') {
            cube.applyMatrix4(
              new THREE.Matrix4().makeRotationY(
                THREE.MathUtils.DEG2RAD * element.rotation.angle!,
              ),
            );
          } else if (element.rotation.axis == 'x') {
            cube.applyMatrix4(
              new THREE.Matrix4().makeRotationX(
                THREE.MathUtils.DEG2RAD * element.rotation.angle!,
              ),
            );
          }

          cube.applyMatrix4(new THREE.Matrix4().makeTranslation(...origin));
          cube.updateMatrix();

          Logger.trace(() => `Element[${i}] rotation applied`);
        }

        cube.renderOrder = ++i;

        scene.add(cube);
        clean.push(cube);
      }

      const stdX =
        Math.sin((gui.rotation[0] + 195) * THREE.MathUtils.DEG2RAD) * 16;
      const stdY =
        Math.sin((gui.rotation[0] + 105) * THREE.MathUtils.DEG2RAD) * 16;
      const stdZ =
        Math.sin((gui.rotation[2] - 45) * THREE.MathUtils.DEG2RAD) * 16;

      const yawDiff = (gui.rotation[1] - 135) * THREE.MathUtils.DEG2RAD;
      const cosYaw = Math.cos(yawDiff);
      const sinYaw = Math.sin(yawDiff);

      const posX = stdX * cosYaw - stdZ * sinYaw;
      const posY = stdY;
      const posZ = stdX * sinYaw + stdZ * cosYaw;

      camera.position.set(posX, posY, posZ);
      camera.lookAt(0, 0, 0);
      camera.position.add(new THREE.Vector3(...gui.translation));
      camera.updateMatrix();
      camera.updateProjectionMatrix();

      Logger.trace(
        () => `Camera position set ${camera.position.toArray().join(',')}`,
      );

      if (block.gui_light === 'front') {
        activeRenderer.light.position.copy(camera.position);
      } else {
        activeRenderer.light.position.set(15, 20, -7);
      }
      activeRenderer.light.updateMatrix();

      renderer.render(scene, camera);

      const buffer = canvas.toBuffer('image/png');
      buffers.push(buffer);

      Logger.trace(
        () => `Image rendered, buffer size = ${buffer.byteLength} bytes`,
      );

      for (const old of clean) {
        scene.remove(old);
        old.geometry.dispose();
      }
      clean.length = 0;

      Logger.trace(() => `Scene cleared`);

      Logger.trace(() => `Frame[${block.animationCurrentTick}] completed`);
    } while (
      options.animation &&
      (block.animationMaxTicks ?? 1) > ++block.animationCurrentTick
    );

    resultBlock.buffer =
      buffers.length == 1
        ? buffers[0]
        : makeAnimatedPNG(buffers, (index) => ({
            numerator: 1,
            denominator: 10,
          }));
  } catch (e: any) {
    for (const old of clean) {
      scene.remove(old);
      old.geometry.dispose();
    }
    resultBlock.skip = e.message || 'error';
  }

  return resultBlock;
}

async function constructTextureMaterial(
  minecraft: Minecraft,
  block: BlockModel,
  path: string,
  face: Face,
  element: Element,
  direction: string,
  activeRenderer: Renderer,
) {
  const cache = activeRenderer.textureCache;
  const animatedCache = activeRenderer.animatedCache;

  const imageCacheKey = 'image:' + path;
  const image = cache[imageCacheKey]
    ? cache[imageCacheKey]
    : (cache[imageCacheKey] = await loadImage(
        await minecraft.getTextureFile(path),
      ));

  const animationMeta = animatedCache[path]
    ? animatedCache[path]
    : (animatedCache[path] = await minecraft.getTextureMetadata(path));

  const width = image.width;
  let height = animationMeta ? width : image.height;
  let frame = 0;

  if (animationMeta) {
    // TODO: Consider custom frame times
    Logger.trace(() => `Face[${direction}] is animated!`);

    const frameCount = image.height / width;

    if (block.animationCurrentTick == 0) {
      block.animationMaxTicks = Math.max(
        block.animationMaxTicks || 1,
        frameCount * (animationMeta.frametime || 1),
      );
    } else {
      frame =
        Math.floor(
          block.animationCurrentTick! / (animationMeta.frametime || 1),
        ) % frameCount;
    }
  }

  // `shade: false` in the model means the face is rendered fullbright,
  // unaffected by scene lighting (e.g. the campfire fire planes). Otherwise
  // faces pointing away from the directional light render pitch black.
  const shaded = element.shade !== false;

  const materialCacheKey = `material:${path}_${face.rotation || 0}_${face.uv ? face.uv.join(',') : ''}_${frame}_${shaded ? 's' : 'u'}`;
  if (cache[materialCacheKey]) {
    return cache[materialCacheKey];
  }

  const canvas = new SkiaCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = false;

  if (face.rotation) {
    ctx.translate(width / 2, height / 2);
    ctx.rotate(face.rotation * THREE.MathUtils.DEG2RAD);
    ctx.translate(-width / 2, -height / 2);

    Logger.trace(() => `Face[${direction}] rotation applied`);
  }

  const uv = face.uv ?? [0, 0, width, height];

  ctx.drawImage(
    image,
    uv[0],
    uv[1] + frame * height,
    uv[2] - uv[0],
    uv[3] - uv[1],
    0,
    0,
    width,
    height,
  );

  Logger.trace(() => `Face[${direction}] uv applied`);

  const texture = new THREE.Texture(canvas as any);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;

  Logger.trace(() => `Face[${direction}] texture is ready`);

  const material = shaded
    ? new THREE.MeshStandardMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        roughness: 1,
        metalness: 0,
        alphaTest: 0.1,
      })
    : new THREE.MeshBasicMaterial({
        map: texture,
        color: 0xffffff,
        transparent: true,
        alphaTest: 0.1,
      });

  cache[materialCacheKey] = material;
  return material;
}

async function constructBlockMaterial(
  minecraft: Minecraft,
  block: BlockModel,
  element: Element,
  activeRenderer: Renderer,
): Promise<THREE.Material[]> {
  if (!element?.faces) {
    Logger.debug(() => `Element faces are missing, will be skipped`);
    return [];
  }

  return <any>(
    await Promise.all(
      MATERIAL_FACE_ORDER.map((direction) =>
        decodeFace(
          direction,
          element?.faces?.[direction],
          block,
          element,
          minecraft,
          activeRenderer,
        ),
      ),
    )
  );
}

async function decodeFace(
  direction: string,
  face: Face | null | undefined,
  block: BlockModel,
  element: Element,
  minecraft: Minecraft,
  activeRenderer: Renderer,
): Promise<THREE.Material | null> {
  if (!face) {
    Logger.trace(() => `Face[${direction}] doesn't exist`);
    return null;
  }

  const decodedTexture = decodeTexture(face.texture, block);

  if (!decodedTexture) {
    Logger.debug(
      () =>
        `Face[${direction}] exist but texture couldn't be decoded! texture=${face.texture}`,
    );
    return null;
  }

  return await constructTextureMaterial(
    minecraft,
    block,
    decodedTexture!,
    face!,
    element,
    direction,
    activeRenderer,
  );
}

function decodeTexture(texture: any, block: BlockModel): string | null {
  if (typeof texture !== 'string') return null;
  if (!texture.startsWith('#')) {
    return texture;
  }

  const correctedTextureName =
    block.textures![texture.substring(1) as BlockSides]!;

  Logger.trace(
    () => `Texture "${texture}" decoded to "${correctedTextureName}"`,
  );

  return decodeTexture(correctedTextureName, block);
}
