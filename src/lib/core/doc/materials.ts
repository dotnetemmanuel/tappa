import type { Hex, LineStyleId, MaterialId } from './types.js';

export type MaterialDef = {
	id: MaterialId;
	sv: string;
	en: string;
	fill: Hex;
	stroke: Hex;
	/** Plan hatch drawn over the fill. */
	pattern: 'none' | 'grass' | 'gravel' | 'paving' | 'deck' | 'water' | 'soil' | 'bark' | 'stone';
	/** Counted in the takeoff as square metres of this group. */
	group: 'soft' | 'hard' | 'water' | 'structure';
};

export const MATERIALS: readonly MaterialDef[] = [
	{
		id: 'lawn',
		sv: 'Gräsmatta',
		en: 'Lawn',
		fill: '#7fa055',
		stroke: '#5f7f3c',
		pattern: 'grass',
		group: 'soft'
	},
	{
		id: 'meadow',
		sv: 'Äng',
		en: 'Meadow',
		fill: '#b3b167',
		stroke: '#8d8a49',
		pattern: 'grass',
		group: 'soft'
	},
	{
		id: 'bed',
		sv: 'Rabatt',
		en: 'Planting bed',
		fill: '#5d4431',
		stroke: '#432f21',
		pattern: 'soil',
		group: 'soft'
	},
	{
		id: 'bark',
		sv: 'Barkmylla',
		en: 'Bark mulch',
		fill: '#8c5733',
		stroke: '#6a3f24',
		pattern: 'bark',
		group: 'soft'
	},
	{
		id: 'kitchen',
		sv: 'Köksland',
		en: 'Kitchen garden',
		fill: '#9c8154',
		stroke: '#79613c',
		pattern: 'soil',
		group: 'soft'
	},
	{
		id: 'gravel',
		sv: 'Grus',
		en: 'Gravel',
		fill: '#c9bda1',
		stroke: '#a2967a',
		pattern: 'gravel',
		group: 'hard'
	},
	{
		id: 'stonedust',
		sv: 'Stenmjöl',
		en: 'Stone dust',
		fill: '#ded8c8',
		stroke: '#b3ad9d',
		pattern: 'gravel',
		group: 'hard'
	},
	{
		id: 'paving',
		sv: 'Plattor',
		en: 'Paving slabs',
		fill: '#b0b5b3',
		stroke: '#868c8a',
		pattern: 'paving',
		group: 'hard'
	},
	{
		id: 'cobble',
		sv: 'Smågatsten',
		en: 'Cobbles',
		fill: '#8b9095',
		stroke: '#666c71',
		pattern: 'stone',
		group: 'hard'
	},
	{
		id: 'asphalt',
		sv: 'Asfalt',
		en: 'Asphalt',
		fill: '#4e5155',
		stroke: '#35383b',
		pattern: 'none',
		group: 'hard'
	},
	{
		id: 'deck',
		sv: 'Trädäck',
		en: 'Timber deck',
		fill: '#b98a4e',
		stroke: '#8f6935',
		pattern: 'deck',
		group: 'hard'
	},
	{
		id: 'concrete',
		sv: 'Betong',
		en: 'Concrete',
		fill: '#c6c3b8',
		stroke: '#9a978c',
		pattern: 'none',
		group: 'hard'
	},
	{
		id: 'water',
		sv: 'Vatten',
		en: 'Water',
		fill: '#4f97b4',
		stroke: '#2f7391',
		pattern: 'water',
		group: 'water'
	},
	{
		id: 'building',
		sv: 'Byggnad',
		en: 'Building',
		fill: '#8d8377',
		stroke: '#655d53',
		pattern: 'none',
		group: 'structure'
	}
];

const byId = new Map(MATERIALS.map((m) => [m.id, m]));

export function material(id: MaterialId): MaterialDef {
	return byId.get(id) ?? MATERIALS[0];
}

export type LineStyleDef = {
	id: LineStyleId;
	sv: string;
	en: string;
	colour: Hex;
	defaultHeight: number;
	defaultThickness: number;
	/** How the run is drawn in plan and built in 3D. */
	render: 'posts' | 'solid' | 'panel' | 'mesh' | 'stone' | 'hedge' | 'trellis';
};

export const LINE_STYLES: readonly LineStyleDef[] = [
	{
		id: 'staket',
		sv: 'Staket',
		en: 'Picket fence',
		colour: '#e2ded2',
		defaultHeight: 0.9,
		defaultThickness: 0.05,
		render: 'posts'
	},
	{
		id: 'plank',
		sv: 'Plank',
		en: 'Solid fence',
		colour: '#9d7c53',
		defaultHeight: 1.8,
		defaultThickness: 0.1,
		render: 'solid'
	},
	{
		id: 'glespanel',
		sv: 'Glespanel',
		en: 'Slatted fence',
		colour: '#c2a075',
		defaultHeight: 1.6,
		defaultThickness: 0.08,
		render: 'panel'
	},
	{
		id: 'gunnebo',
		sv: 'Gunnebostängsel',
		en: 'Wire mesh',
		colour: '#aab2b0',
		defaultHeight: 1.2,
		defaultThickness: 0.03,
		render: 'mesh'
	},
	{
		id: 'stenmur',
		sv: 'Stenmur',
		en: 'Stone wall',
		colour: '#8f8d84',
		defaultHeight: 0.6,
		defaultThickness: 0.4,
		render: 'stone'
	},
	{
		id: 'hack',
		sv: 'Häck',
		en: 'Hedge',
		colour: '#4f7440',
		defaultHeight: 1.4,
		defaultThickness: 0.6,
		render: 'hedge'
	},
	{
		id: 'spalje',
		sv: 'Spaljé',
		en: 'Trellis',
		colour: '#c49a63',
		defaultHeight: 1.8,
		defaultThickness: 0.04,
		render: 'trellis'
	},
	{
		id: 'kant',
		sv: 'Kantstöd',
		en: 'Edging',
		colour: '#7c7a73',
		defaultHeight: 0.1,
		defaultThickness: 0.05,
		render: 'solid'
	}
];

const lineById = new Map(LINE_STYLES.map((s) => [s.id, s]));

export function lineStyle(id: LineStyleId): LineStyleDef {
	return lineById.get(id) ?? LINE_STYLES[0];
}
