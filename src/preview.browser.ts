// Interactive, live block preview for the browser.
//
// The batch `render` pipeline bakes a block to a still PNG from Minecraft's
// fixed inventory camera. This instead keeps a three.js scene alive on a canvas
// so the block can be orbited by dragging, zoomed with the wheel, and optionally
// spun on its own axis — reusing `buildBlockMeshes` so the geometry is identical
// to what the still renderer produces. Browser-only (uses the DOM + a live GL
// context); exported from `browser.ts`.
import * as THREE from 'three';
import {
  buildBlockMeshes,
  applyGuiCamera,
  resolveGuiTransform,
  positionGuiLight,
  DEFAULT_GUI,
} from './render.js';
import type { Minecraft } from './minecraft.js';
import type { BlockModel, Renderer } from './utils/types.js';

export interface BlockPreviewOptions {
  /** Spin the block around its vertical axis on load. Default false. */
  autoRotate?: boolean;
  /** Radians added to the yaw per frame while auto-rotating. Default 0.012. */
  autoRotateSpeed?: number;
  /**
   * Bind drag-to-rotate / wheel-to-zoom listeners. Default true. Set false for
   * a passive, display-only preview (e.g. a spinning thumbnail) that must not
   * swallow clicks on the element behind it.
   */
  input?: boolean;
  /**
   * Camera projection. `orthographic` (default) starts from — and matches — the
   * still renderer's inventory view; `perspective` adds foreshortening.
   */
  cameraType?: 'orthographic' | 'perspective';
  /** Orthographic half-frustum size; mirror the still render's `distance`. */
  distance?: number;
  /** Rotate the key light around the vertical axis, in degrees (default 0). */
  lightAngle?: number;
}

export interface BlockPreview {
  /** Toggle the self-rotation flag on/off at runtime. */
  setAutoRotate(enabled: boolean): void;
  /** Swap the previewed block, keeping the current camera orientation. */
  setBlock(block: BlockModel): Promise<void>;
  /** Pause/resume the render loop (pause a preview that's off screen). */
  setActive(active: boolean): void;
  /** Rotate the key light around the vertical axis, in degrees. */
  setLightAngle(degrees: number): void;
  /** Re-read the canvas size (call after its CSS box changes). */
  resize(): void;
  /** Tear down the GL context and remove input listeners. */
  dispose(): void;
}

/**
 * Mounts a live, orbitable preview of `block` onto `canvas`. Assets are pulled
 * through `minecraft` (its caches are reused), and materials are baked exactly
 * as the still renderer bakes them. The camera starts at the same Minecraft
 * inventory pose the still thumbnail uses, so the two are identical at rest and
 * the user rotates the block from there.
 */
export async function createBlockPreview(
  canvas: HTMLCanvasElement,
  minecraft: Minecraft,
  block: BlockModel,
  options: BlockPreviewOptions = {},
): Promise<BlockPreview> {
  // Match the still renderer's flat, pass-through colour pipeline.
  THREE.ColorManagement.enabled = false;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.sortObjects = false;

  const scene = new THREE.Scene();

  const perspective = options.cameraType === 'perspective';
  const dist = options.distance ?? 20;
  const camera: THREE.OrthographicCamera | THREE.PerspectiveCamera = perspective
    ? new THREE.PerspectiveCamera(30, 1, 0.01, 20000)
    : new THREE.OrthographicCamera(-dist, dist, dist, -dist, 0.01, 20000);

  // Same light rig (and PI-scaled intensities) as the still renderer; its
  // position is set per block in `loadBlock` to match that block's gui_light.
  const light = new THREE.DirectionalLight(0xffffff, Math.PI);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.3 * Math.PI));

  // A lightweight stand-in: `buildBlockMeshes` only reads these three fields.
  const bakeContext = {
    textureCache: {},
    animatedCache: {},
    options: { interpolate: true, interpolationSteps: 8, animation: false },
  } as unknown as Renderer;

  // The block sits unrotated at the origin; the camera provides the inventory
  // pose. Dragging/spin then rotate this group away from that starting view.
  const group = new THREE.Group();
  scene.add(group);

  let autoRotate = options.autoRotate ?? false;
  const spinSpeed = options.autoRotateSpeed ?? 0.012;
  let lightAngle = options.lightAngle ?? 0;
  let currentBlock: BlockModel = block;

  async function loadBlock(model: BlockModel) {
    disposeGroupChildren();
    const meshes = await buildBlockMeshes(minecraft, model, bakeContext, 0);
    for (const mesh of meshes) group.add(mesh);
    currentBlock = model;

    // Reset to the block's own inventory pose (each block may differ), so the
    // preview opens on exactly the thumbnail's view.
    group.rotation.set(0, 0, 0);
    const gui = resolveGuiTransform(model) ?? DEFAULT_GUI;
    applyGuiCamera(camera, gui);
    positionGuiLight(light, model, camera.position, lightAngle);
  }

  function disposeGroupChildren() {
    for (const child of [...group.children]) {
      group.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const material of materials) {
        if (!material) continue;
        (material as any).map?.dispose?.();
        material.dispose();
      }
    }
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const aspect = width / height;
    // Only touch framing here — the gui pose (zoom/position) is owned by
    // `loadBlock` and must survive a resize.
    if (perspective) {
      (camera as THREE.PerspectiveCamera).aspect = aspect;
    } else {
      const ortho = camera as THREE.OrthographicCamera;
      ortho.left = -dist * aspect;
      ortho.right = dist * aspect;
      ortho.top = dist;
      ortho.bottom = -dist;
    }
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
  }

  // --- input: drag to rotate, wheel to zoom -------------------------------
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    group.rotation.y += (e.clientX - lastX) * 0.01;
    group.rotation.x += (e.clientY - lastY) * 0.01;
    // Keep the block from flipping fully upside down.
    group.rotation.x = Math.max(-1.5, Math.min(1.5, group.rotation.x));
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // pointer may already be released
    }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    camera.zoom = Math.max(0.3, Math.min(6, camera.zoom * factor));
    camera.updateProjectionMatrix();
  };

  const useInput = options.input !== false;
  if (useInput) {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
  }

  await loadBlock(block);
  resize();

  const loop = () => {
    if (autoRotate) group.rotation.y += spinSpeed;
    renderer.render(scene, camera);
  };
  let active = true;
  renderer.setAnimationLoop(loop);

  return {
    setAutoRotate(enabled: boolean) {
      autoRotate = enabled;
    },
    async setBlock(model: BlockModel) {
      await loadBlock(model);
    },
    setActive(next: boolean) {
      if (next === active) return;
      active = next;
      renderer.setAnimationLoop(next ? loop : null);
    },
    setLightAngle(degrees: number) {
      lightAngle = degrees;
      positionGuiLight(light, currentBlock, camera.position, lightAngle);
    },
    resize,
    dispose() {
      renderer.setAnimationLoop(null);
      if (useInput) {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointerleave', onPointerUp);
        canvas.removeEventListener('wheel', onWheel);
      }
      disposeGroupChildren();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
