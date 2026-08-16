import type { Vec2 } from '../geom/vec2.js';

export const SCHEMA_VERSION = 1;

export type EntityId = string;
export type LayerId = string;
export type NodeId = string;
export type AssetId = string;
export type SpeciesId = string;
export type PropId = string;
export type MaterialId = string;
export type LineStyleId = string;

/** `#rrggbb`. */
export type Hex = string;

export type Layer = {
	id: LayerId;
	name: string;
	visible: boolean;
	locked: boolean;
};

/** A catalog material plus per-entity overrides. */
export type SurfaceMat = {
	id: MaterialId;
	fill?: Hex;
	asset?: AssetId;
	repeat?: number;
	rot?: number;
};

export type LineStyle = {
	id: LineStyleId;
	colour?: Hex;
};

export type Opening = {
	id: string;
	type: 'door' | 'window';
	/** Position along the wall, 0 at node `a`, 1 at node `b`. */
	t: number;
	width: number;
	height: number;
	sill: number;
};

/**
 * A point that follows the geometry it names. `free` is a bare coordinate;
 * the rest resolve against the document so dimensions survive an edit.
 */
export type Anchor =
	| { k: 'free'; at: Vec2 }
	| { k: 'vertex'; e: EntityId; i: number }
	| { k: 'edge'; e: EntityId; i: number; t: number }
	| { k: 'node'; n: NodeId };

type Base = {
	id: EntityId;
	layer: LayerId;
	name?: string;
};

export type AreaEntity = Base & {
	k: 'area';
	mat: SurfaceMat;
	ring: Vec2[];
	holes?: Vec2[][];
	elev?: number;
};

export type PathEntity = Base & {
	k: 'path';
	mat: SurfaceMat;
	spine: Vec2[];
	width: number;
	radius?: number;
};

export type LineEntity = Base & {
	k: 'line';
	style: LineStyle;
	spine: Vec2[];
	height: number;
	thickness: number;
};

export type WallEntity = Base & {
	k: 'wall';
	a: NodeId;
	b: NodeId;
	thickness: number;
	height: number;
	openings: Opening[];
};

export type RoofEntity = Base & {
	k: 'roof';
	over: EntityId[];
	type: 'gable' | 'hip' | 'mono' | 'flat';
	pitchDeg: number;
	ridgeDeg: number;
	overhang: number;
};

export type PlantEntity = Base & {
	k: 'plant';
	species: SpeciesId;
	at: Vec2;
	rot: number;
	sizeJitter: number;
	plantedYear: number;
};

export type PropEntity = Base & {
	k: 'prop';
	kind: PropId;
	at: Vec2;
	rot: number;
	scale?: number;
	params?: Record<string, number>;
};

export type ImageEntity = Base & {
	k: 'image';
	asset: AssetId;
	transform: { at: Vec2; rot: number; mPerPx: number };
	opacity: number;
	mode: 'underlay' | 'billboard' | 'texture';
	locked?: boolean;
};

export type DimEntity = Base & {
	k: 'dim';
	from: Anchor;
	to: Anchor;
	/** Perpendicular distance from the measured line to the dimension line. */
	offset: number;
	text?: string;
};

export type LabelEntity = Base & {
	k: 'label';
	at: Vec2;
	text: string;
	size: number;
	rot?: number;
};

export type Entity =
	| AreaEntity
	| PathEntity
	| LineEntity
	| WallEntity
	| RoofEntity
	| PlantEntity
	| PropEntity
	| ImageEntity
	| DimEntity
	| LabelEntity;

export type EntityKind = Entity['k'];

export type AssetRef = {
	id: AssetId;
	/** Content hash; two identical drops share one blob. */
	hash: string;
	name: string;
	mime: string;
	w: number;
	h: number;
	bytes: number;
};

export type DocMeta = {
	name: string;
	created: string;
	modified: string;
	lat: number;
	lon: number;
	/** Degrees to rotate plan north away from +y, for a plot that is not square to north. */
	northOffset: number;
};

export type Doc = {
	schema: number;
	meta: DocMeta;
	plot: { boundary: Vec2[] };
	layers: Layer[];
	/** Shared wall endpoints. Dragging one moves every wall that references it. */
	nodes: Record<NodeId, Vec2>;
	entities: Entity[];
	assets: AssetRef[];
};

export const isArea = (e: Entity): e is AreaEntity => e.k === 'area';
export const isPath = (e: Entity): e is PathEntity => e.k === 'path';
export const isLine = (e: Entity): e is LineEntity => e.k === 'line';
export const isWall = (e: Entity): e is WallEntity => e.k === 'wall';
export const isPlant = (e: Entity): e is PlantEntity => e.k === 'plant';
export const isImage = (e: Entity): e is ImageEntity => e.k === 'image';
export const isDim = (e: Entity): e is DimEntity => e.k === 'dim';
export const isLabel = (e: Entity): e is LabelEntity => e.k === 'label';
