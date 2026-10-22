// Official artwork (cropped from "All Cards.pdf" by tools/extract_assets.py).
// manifest.json carries the measured money-grid and round-tracker geometry.

import manifest from '../../public/art/manifest.json';
import type { Role } from './types';

export const ART_BASE = `${import.meta.env.BASE_URL}art/`;
/** A path inside public/art (manifest paths). */
export const art = (path: string) => `${ART_BASE}${path}`;
/** A path inside public/ (card catalog paths already start with "art/"). */
export const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export interface CharacterGeometry {
  src: string;
  width: number;
  height: number;
  colEdges: number[]; // 4 x-edges (pixels) of the 3 printed columns
  rowEdges: number[]; // 8 y-edges of the 7 printed rows
}

export const characterCard = (role: Role): CharacterGeometry => manifest.character[role];
export const roundTracker = manifest.roundTracker as { src: string; width: number; height: number; centersX: number[] };
export const tokenSrc = art(manifest.token);
export const bannerSrc = art(manifest.banner);
export const backSrc = (deck: Role | 'character', small = true) => art(manifest.backs[deck][small ? 'small' : 'full']);
