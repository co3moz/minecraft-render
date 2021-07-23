import * as THREE from 'three';
import * as rawCanvas from 'canvas';

//@ts-ignore
import { createCanvas, loadImage } from 'node-canvas-webgl';
import type { BlockModel, BlockSides, Element, Face, Renderer } from './utils/types';
import type { Minecraft } from './minecraft';
import { distance, invert, mul, size } from './utils/vector-math';

const DEBUG_PLANE = 0;

export async function prepareRenderer(): Promise<Renderer> {
  const width = 1000;
  const height = 1000;

  const scene = new THREE.Scene();

  const canvas: rawCanvas.Canvas = createCanvas(width, height);

  const renderer = new THREE.WebGLRenderer({
    canvas: (canvas as any),
    antialias: true,
    alpha: true,
    logarithmicDepthBuffer: true,
  });

  renderer.sortObjects = false;

  const aspect = width / height;
  const distance = 20;
  const camera = new THREE.OrthographicCamera(- distance * aspect, distance * aspect, distance, - distance, 0.01, 20000);

  const light = new THREE.DirectionalLight(0xFFFFFF, 1.2);
  light.position.set(15, 20, -10);
  scene.add(light);

  if (DEBUG_PLANE) {
    const origin = new THREE.Vector3(0, 0, 0);
    const length = 10;
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, length, 0xff0000));
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, length, 0x00ff00));
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, length, 0x0000ff));

    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 3);
    const helper = new THREE.PlaneHelper(plane, 30, 0xffff00);
    scene.add(helper);
  }

  return { scene, renderer, canvas, camera, textureCache: {} };
}

export async function destroyRenderer(renderer: Renderer) {
  await new Promise(resolve => setTimeout(resolve, 500));
  renderer.renderer.info.reset();
  (renderer.canvas as any).__gl__.getExtension('STACKGL_destroy_context').destroy();
}

export async function render(minecraft: Minecraft, block: BlockModel): Promise<BlockModel & { buffer: Buffer, skip?: string }> {
  const { canvas, renderer, scene, camera } = minecraft._renderer!;
  const resultBlock: BlockModel & { buffer: Buffer, skip?: string } = block as any;

  const gui = block.display?.gui;

  if (!gui || !block.elements || !block.textures) {
    resultBlock.skip = !gui ? 'no gui' : (!block.elements ? 'no element' : 'no texture');
    return resultBlock;
  }

  const clean = [];
  console.log('rendering: ' + block.blockName + ' ' + JSON.stringify(gui) + ' textures ' + JSON.stringify(block.textures));

  camera.zoom = 1.0 / distance(gui.scale);

  block.elements!.reverse();
  let i = 0;

  for (const element of block.elements!) {
    element.calculatedSize = size(element.from!, element.to!);
    console.log('element size: ', element.calculatedSize, JSON.stringify(element));

    const geometry = new THREE.BoxGeometry(...element.calculatedSize, 1, 1, 1);
    const cube = new THREE.Mesh(geometry, await constructBlockMaterial(minecraft, block, element));

    cube.position.set(0, 0, 0);
    cube.position.add(new THREE.Vector3(...element.from!));
    cube.position.add(new THREE.Vector3(...element.to!));
    cube.position.multiplyScalar(0.5);
    cube.position.add(new THREE.Vector3(-8, -8, -8))


    if (element.rotation) {
      const origin = mul(element.rotation.origin!, -0.0625);
      // const origin = invert(element.rotation.origin!)
      cube.applyMatrix4(new THREE.Matrix4().makeTranslation(...invert(origin)))

      if (element.rotation.axis == 'y') {
        cube.applyMatrix4(new THREE.Matrix4().makeRotationY(THREE.MathUtils.DEG2RAD * element.rotation.angle!))
      } else if (element.rotation.axis == 'x') {
        cube.applyMatrix4(new THREE.Matrix4().makeRotationX(THREE.MathUtils.DEG2RAD * element.rotation.angle!))
      }
      
      cube.applyMatrix4(new THREE.Matrix4().makeTranslation(...origin))

      cube.updateMatrix();
    }

    cube.renderOrder = ++i;

    scene.add(cube);
    clean.push(cube);
  }

  // const rotation = new THREE.Vector3(...gui.rotation).sub(new THREE.Vector3(15, 188.130102, -45));
  // const rotation = new THREE.Vector3(...gui.rotation).add(new THREE.Vector3(15, 188.130102, -45));
  const rotation = new THREE.Vector3(...gui.rotation).add(new THREE.Vector3(15, 165, -45));
  camera.position.set(...rotation.toArray().map(x => Math.sin(x * THREE.MathUtils.DEG2RAD) * 16) as [number, number, number]);
  camera.lookAt(0, 0, 0)
  camera.position.add(new THREE.Vector3(...gui.translation));
  camera.updateMatrix();
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);

  const buffer = canvas.toBuffer('image/png');

  for (const old of clean) {
    scene.remove(old);
  }

  resultBlock.buffer = buffer;
  return resultBlock;
}

async function constructTextureMaterial(minecraft: Minecraft, path: string, face: Face, element: Element) {
  const cache = minecraft._renderer!.textureCache;
  const image = cache[path] ? cache[path] : (cache[path] = await loadImage(await minecraft.getTextureFile(path)));

  const canvas = rawCanvas.createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');

  ctx.imageSmoothingEnabled = false;

  if (face.rotation) {
    ctx.translate(image.width / 2, image.height / 2);
    ctx.rotate(face.rotation * THREE.MathUtils.DEG2RAD);
    ctx.translate(-image.width / 2, -image.height / 2);
  }

  const uv = face.uv ?? [0, 0, image.width, image.height];

  ctx.drawImage(image, uv[0], uv[1], uv[2] - uv[0], uv[3] - uv[1], 0, 0, image.width, image.height);

  const texture = new THREE.Texture(canvas as any);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipMapLinearFilter;
  texture.needsUpdate = true;

  return new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    transparent: true,
    roughness: 1,
    metalness: 0,
    emissive: 1,
    alphaTest: 0.2
  });
}

async function constructBlockMaterial(minecraft: Minecraft, block: BlockModel, element: Element): Promise<THREE.Material[]> {
  if (!element?.faces) { return [] };

  const { north, south, east, west, up, down } = element?.faces;

  return <any>await Promise.all([east, west, up, down, south, north].map(face => decodeFace(face, block, element, minecraft)));
}

async function decodeFace(face: Face | null | undefined, block: BlockModel, element: Element, minecraft: Minecraft): Promise<THREE.Material | null> {
  if (!face) return null;
  const decodedTexture = decodeTexture(face.texture, block);
  if (!decodedTexture) return null;
  return await constructTextureMaterial(minecraft, decodedTexture!, face!, element)
}

function decodeTexture(texture: string, block: BlockModel): string | null {
  texture = texture ?? '';
  if (!texture) return null;
  if (!texture.startsWith('#')) {
    return texture;
  }

  return decodeTexture((block.textures!)[texture.substring(1) as BlockSides]!, block);
}