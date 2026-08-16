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
		fill: '#8faa62',
		stroke: '#6f8a48',
		pattern: 'grass',
		group: 'soft'
	},
	{
		id: 'meadow',
		sv: 'Äng',
		en: 'Meadow',
		fill: '#a3b06a',
		stroke: '#7f8c4c',
		pattern: 'grass',
		group: 'soft'
	},
	{
		id: 'bed',
		sv: 'Rabatt',
		en: 'Planting bed',
		fill: '#7a5c42',
		stroke: '#5d4632',
		pattern: 'soil',
		group: 'soft'
	},
	{
		id: 'bark',
		sv: 'Barkmylla',
		en: 'Bark mulch',
		fill: '#8a6742',
		stroke: '#6b4f32',
		pattern: 'bark',
		group: 'soft'
	},
	{
		id: 'kitchen',
		sv: 'Köksland',
		en: 'Kitchen garden',
		fill: '#8a6b45',
		stroke: '#6a5134',
		pattern: 'soil',
		group: 'soft'
	},
	{
		id: 'gravel',
		sv: 'Grus',
		en: 'Gravel',
		fill: '#c2bcae',
		stroke: '#9d968a',
		pattern: 'gravel',
		group: 'hard'
	},
	{
		id: 'stonedust',
		sv: 'Stenmjöl',
		en: 'Stone dust',
		fill: '#cac5b6',
		stroke: '#a49e90',
		pattern: 'gravel',
		group: 'hard'
	},
	{
		id: 'paving',
		sv: 'Plattor',
		en: 'Paving slabs',
		fill: '#bdbdb6',
		stroke: '#8f8f89',
		pattern: 'paving',
		group: 'hard'
	},
	{
		id: 'cobble',
		sv: 'Smågatsten',
		en: 'Cobbles',
		fill: '#a8a8a4',
		stroke: '#7d7d79',
		pattern: 'stone',
		group: 'hard'
	},
	{
		id: 'asphalt',
		sv: 'Asfalt',
		en: 'Asphalt',
		fill: '#6e6e70',
		stroke: '#525254',
		pattern: 'none',
		group: 'hard'
	},
	{
		id: 'deck',
		sv: 'Trädäck',
		en: 'Timber deck',
		fill: '#b08b5c',
		stroke: '#8a6c45',
		pattern: 'deck',
		group: 'hard'
	},
	{
		id: 'concrete',
		sv: 'Betong',
		en: 'Concrete',
		fill: '#b6b6b0',
		stroke: '#8b8b86',
		pattern: 'none',
		group: 'hard'
	},
	{
		id: 'water',
		sv: 'Vatten',
		en: 'Water',
		fill: '#6f9fb5',
		stroke: '#4e7d92',
		pattern: 'water',
		group: 'water'
	},
	{
		id: 'building',
		sv: 'Byggnad',
		en: 'Building',
		fill: '#9a9086',
		stroke: '#6f675e',
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
		colour: '#d8d2c4',
		defaultHeight: 0.9,
		defaultThickness: 0.05,
		render: 'posts'
	},
	{
		id: 'plank',
		sv: 'Plank',
		en: 'Solid fence',
		colour: '#a98a63',
		defaultHeight: 1.8,
		defaultThickness: 0.1,
		render: 'solid'
	},
	{
		id: 'glespanel',
		sv: 'Glespanel',
		en: 'Slatted fence',
		colour: '#b99a72',
		defaultHeight: 1.6,
		defaultThickness: 0.08,
		render: 'panel'
	},
	{
		id: 'gunnebo',
		sv: 'Gunnebostängsel',
		en: 'Wire mesh',
		colour: '#9aa2a0',
		defaultHeight: 1.2,
		defaultThickness: 0.03,
		render: 'mesh'
	},
	{
		id: 'stenmur',
		sv: 'Stenmur',
		en: 'Stone wall',
		colour: '#9c9a92',
		defaultHeight: 0.6,
		defaultThickness: 0.4,
		render: 'stone'
	},
	{
		id: 'hack',
		sv: 'Häck',
		en: 'Hedge',
		colour: '#5f7d46',
		defaultHeight: 1.4,
		defaultThickness: 0.6,
		render: 'hedge'
	},
	{
		id: 'spalje',
		sv: 'Spaljé',
		en: 'Trellis',
		colour: '#b08b5c',
		defaultHeight: 1.8,
		defaultThickness: 0.04,
		render: 'trellis'
	},
	{
		id: 'kant',
		sv: 'Kantstöd',
		en: 'Edging',
		colour: '#8d8a82',
		defaultHeight: 0.1,
		defaultThickness: 0.05,
		render: 'solid'
	}
];

const lineById = new Map(LINE_STYLES.map((s) => [s.id, s]));

export function lineStyle(id: LineStyleId): LineStyleDef {
	return lineById.get(id) ?? LINE_STYLES[0];
}
