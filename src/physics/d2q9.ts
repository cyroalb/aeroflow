// Order: 0 rest, 1 E, 2 N, 3 W, 4 S, 5 NE, 6 NW, 7 SW, 8 SE
export const C: readonly [number, number][] = [
  [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1],
];
export const W: readonly number[] = [
  4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36,
];
export const OPP: readonly number[] = [0, 3, 4, 1, 2, 7, 8, 5, 6];
export const MIRROR_Y: readonly number[] = [0, 1, 4, 3, 2, 8, 7, 6, 5];
