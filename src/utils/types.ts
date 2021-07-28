import type * as THREE from 'three';
import type * as rawCanvas from 'canvas';

export type UnwrapPromise<T> = T extends PromiseLike<infer U> ? U : T
export type UnwrapArray<T> = T extends Array<infer U> ? U : T

export type Vector = readonly [number, number, number];
export type Vector4 = readonly [number, number, number, number];

export interface Transform {
  rotation: Vector
  translation: Vector
  scale: Vector
}

export interface Rotation {
  angle?: number
  axis?: string
  origin?: Vector
}

export type BlockFaces = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
export type BlockSides = 'all' | 'top' | 'bottom' | 'side' | 'front' | 'particle' | 'pane' | 'wood' | 'back' | BlockFaces;

export interface BlockModel {
  blockName?: string
  parents?: string[]
  animationMaxTicks?: number
  animationCurrentTick?: number


  parent?: string
  textures?: {
    [key in BlockSides]?: string
  }
  gui_light?: "front" | "side",
  display?: {
    gui?: Transform,
    ground?: Transform
    fixed?: Transform
    thirdperson_righthand?: Transform
    firstperson_righthand?: Transform
    firstperson_lefthand?: Transform
  }
  elements?: Element[]
}

export interface Element {
  from?: Vector
  to?: Vector
  rotation?: Rotation
  faces?: {
    [key in BlockFaces]?: Face
  }

  calculatedSize?: Vector
}

export interface Face {
  uv?: Vector4,
  texture: string,
  rotation?: number
  cullface?: string
}

export interface Renderer {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  canvas: rawCanvas.Canvas
  camera: THREE.OrthographicCamera
  textureCache: { [key: string]: any }
  animatedCache: { [key: string]: AnimationMeta | null }
  options: RendererOptions
}

export type AnimationMeta = {
  interpolate?: boolean // Generate additional frames between keyframes where frametime > 1
  width?: number //Custom dimensions for none square textures, unused in vanilla
  height?: number,
  frametime?: number // Frame time in game ticks, default is 1
  frames?: (number|{ index: number, time: number})[]
}

export interface RendererOptions {
  width?: number
  height?: number
  distance?: number
  verbose?: number
  plane?: number
  animation?: boolean
}