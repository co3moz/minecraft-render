import { Vector } from './types.js';

export function size(from: Vector, to: Vector) {
  return [
    to[0] - from[0],
    to[1] - from[1],
    to[2] - from[2]
  ] as const;
}

export function invert(v: Vector) {
  return [
    -v[0],
    -v[1],
    -v[2],
  ] as const;
}

export function mul(v: Vector, f: number) {
  return [
    v[0] * f,
    v[1] * f,
    v[2] * f,
  ] as const;
}

export function distance(v: Vector) {
  return Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2);
}