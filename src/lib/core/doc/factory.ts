import type { Vec2 } from '../geom/vec2.js';
import { nextId } from './ids.js';
import { lineStyle } from './materials.js';
import type {
	Anchor,
	AreaEntity,
	DimEntity,
	ImageEntity,
	LabelEntity,
	LineEntity,
	LineStyleId,
	MaterialId,
	NodeId,
	PathEntity,
	PlantEntity,
	PropEntity,
	PropId,
	RoofEntity,
	SpeciesId,
	SpotEntity,
	WallEntity
} from './types.js';

export function makeArea(ring: Vec2[], mat: MaterialId, layer = 'surfaces'): AreaEntity {
	return { k: 'area', id: nextId('area'), layer, mat: { id: mat }, ring };
}

export function makePath(
	spine: Vec2[],
	mat: MaterialId,
	width: number,
	layer = 'surfaces'
): PathEntity {
	return { k: 'path', id: nextId('path'), layer, mat: { id: mat }, spine, width };
}

export function makeLine(
	spine: Vec2[],
	style: LineStyleId,
	height: number,
	layer = 'structures'
): LineEntity {
	const def = lineStyle(style);
	return {
		k: 'line',
		id: nextId('line'),
		layer,
		style: { id: style },
		spine,
		height,
		thickness: def.defaultThickness
	};
}

export function makeDim(from: Anchor, to: Anchor, offset: number, layer = 'annotation'): DimEntity {
	return { k: 'dim', id: nextId('dim'), layer, from, to, offset };
}

export function makeSpot(at: Vec2, z: number, layer = 'ground'): SpotEntity {
	return { k: 'spot', id: nextId('spot'), layer, at, z };
}

export function makeLabel(at: Vec2, text: string, layer = 'annotation'): LabelEntity {
	return { k: 'label', id: nextId('label'), layer, at, text, size: 0.4 };
}

export function makeWall(
	a: NodeId,
	b: NodeId,
	thickness: number,
	height: number,
	layer = 'structures'
): WallEntity {
	return { k: 'wall', id: nextId('wall'), layer, a, b, thickness, height, openings: [] };
}

export function makeRoof(
	over: string[],
	type: RoofEntity['type'],
	pitchDeg: number,
	ridgeDeg: number,
	layer = 'structures'
): RoofEntity {
	return { k: 'roof', id: nextId('roof'), layer, over, type, pitchDeg, ridgeDeg, overhang: 0.4 };
}

export function makePlant(
	at: Vec2,
	species: SpeciesId,
	plantedYear: number,
	jitter: number,
	layer = 'planting'
): PlantEntity {
	return {
		k: 'plant',
		id: nextId('plant'),
		layer,
		species,
		at,
		rot: 0,
		sizeJitter: jitter,
		plantedYear
	};
}

export function makeProp(at: Vec2, kind: PropId, layer = 'structures'): PropEntity {
	return { k: 'prop', id: nextId('prop'), layer, kind, at, rot: 0 };
}

export function makeImage(
	asset: string,
	at: Vec2,
	mPerPx: number,
	mode: ImageEntity['mode'] = 'underlay',
	layer = 'underlay'
): ImageEntity {
	return {
		k: 'image',
		id: nextId('image'),
		layer,
		asset,
		transform: { at, rot: 0, mPerPx },
		opacity: 0.85,
		mode,
		locked: mode === 'underlay'
	};
}
