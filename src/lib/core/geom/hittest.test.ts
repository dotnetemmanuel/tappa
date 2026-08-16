import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../doc/types.js';
import type {
	AreaEntity,
	DimEntity,
	Doc,
	Entity,
	ImageEntity,
	Layer,
	LabelEntity,
	PathEntity,
	PlantEntity,
	WallEntity
} from '../doc/types.js';
import { v, type Vec2 } from './vec2.js';
import { pick, pickAll, pickInRect, pickNode, pickPlot } from './hittest.js';

const OPEN: Layer = { id: 'open', name: 'Open', visible: true, locked: false };
const HIDDEN: Layer = { id: 'hidden', name: 'Hidden', visible: false, locked: false };
const LOCKED: Layer = { id: 'locked', name: 'Locked', visible: true, locked: true };

function makeDoc(p: {
	entities?: Entity[];
	layers?: Layer[];
	nodes?: Record<string, Vec2>;
	boundary?: Vec2[];
}): Doc {
	return {
		schema: SCHEMA_VERSION,
		meta: {
			name: 'test',
			created: '2026-01-01T00:00:00.000Z',
			modified: '2026-01-01T00:00:00.000Z',
			lat: 59.4,
			lon: 17.9,
			northOffset: 0
		},
		plot: { boundary: p.boundary ?? [] },
		layers: p.layers ?? [OPEN, HIDDEN, LOCKED],
		nodes: p.nodes ?? {},
		entities: p.entities ?? [],
		assets: []
	};
}

const area = (id: string, ring: Vec2[], layer = 'open', holes?: Vec2[][]): AreaEntity => ({
	id,
	k: 'area',
	layer,
	mat: { id: 'grass' },
	ring,
	holes
});

const plant = (id: string, at: Vec2, layer = 'open'): PlantEntity => ({
	id,
	k: 'plant',
	layer,
	species: 'malus',
	at,
	rot: 0,
	sizeJitter: 0,
	plantedYear: 2026
});

const label = (id: string, at: Vec2, layer = 'open'): LabelEntity => ({
	id,
	k: 'label',
	layer,
	at,
	text: 'köksland',
	size: 0.3
});

const path = (id: string, spine: Vec2[], width: number, layer = 'open'): PathEntity => ({
	id,
	k: 'path',
	layer,
	mat: { id: 'gravel' },
	spine,
	width
});

const wall = (id: string, a: string, b: string, layer = 'open'): WallEntity => ({
	id,
	k: 'wall',
	layer,
	a,
	b,
	thickness: 0.3,
	height: 2.4,
	openings: []
});

const dim = (id: string, from: Vec2, to: Vec2, layer = 'open'): DimEntity => ({
	id,
	k: 'dim',
	layer,
	from: { k: 'free', at: from },
	to: { k: 'free', at: to },
	offset: 0.5
});

const image = (id: string, at: Vec2, locked: boolean, layer = 'open'): ImageEntity => ({
	id,
	k: 'image',
	layer,
	asset: 'missing',
	transform: { at, rot: 0, mPerPx: 0.01 },
	opacity: 1,
	mode: 'underlay',
	locked
});

const SQUARE = (): Vec2[] => [v(0, 0), v(10, 0), v(10, 10), v(0, 10)];

describe('pick draw order', () => {
	it('returns the area drawn last when two fills overlap', () => {
		const doc = makeDoc({ entities: [area('under', SQUARE()), area('over', SQUARE())] });
		const p = pick(doc, v(5, 5), { tolerance: 0.2 });
		expect(p).toMatchObject({ part: 'body' });
		expect(p?.entity.id).toBe('over');
	});

	it('follows the array, not the size, when the order is reversed', () => {
		const small = area('small', [v(2, 2), v(8, 2), v(8, 8), v(2, 8)]);
		const doc = makeDoc({ entities: [small, area('big', SQUARE())] });
		expect(pick(doc, v(5, 5), { tolerance: 0.2 })?.entity.id).toBe('big');
	});

	it('breaks a tie between two coincident vertices with the later entity', () => {
		const doc = makeDoc({
			entities: [area('first', SQUARE()), area('second', SQUARE())]
		});
		const p = pick(doc, v(10.02, 0), { tolerance: 0.2 });
		expect(p).toMatchObject({ part: 'vertex', index: 1 });
		expect(p?.entity.id).toBe('second');
	});
});

describe('pick quality order', () => {
	it('prefers a vertex 0.05 m away over a fill that contains the point exactly', () => {
		const handle = area('handle', [v(5.05, 5), v(6, 5), v(6, 6)]);
		const doc = makeDoc({ entities: [handle, area('fill', SQUARE())] });
		const p = pick(doc, v(5, 5), { tolerance: 0.2 });
		expect(p?.entity.id).toBe('handle');
		expect(p).toMatchObject({ part: 'vertex', index: 0 });
		expect(p?.d).toBeCloseTo(0.05, 10);
	});

	it('prefers an edge over the fill it belongs to', () => {
		const doc = makeDoc({ entities: [area('a', SQUARE())] });
		const p = pick(doc, v(5, 0.05), { tolerance: 0.2 });
		expect(p).toMatchObject({ part: 'edge', index: 0 });
	});

	it('prefers a vertex over an edge that passes through it', () => {
		const doc = makeDoc({ entities: [area('a', SQUARE())] });
		expect(pick(doc, v(0.03, 0.03), { tolerance: 0.2 })).toMatchObject({
			part: 'vertex',
			index: 0
		});
	});
});

describe('edges', () => {
	it('reports the segment index and a fractional t', () => {
		const doc = makeDoc({ entities: [area('a', SQUARE())] });
		const p = pick(doc, v(2, -0.05), { tolerance: 0.2 });
		if (p?.part !== 'edge') throw new Error('expected an edge hit');
		expect(p.index).toBe(0);
		expect(p.t).toBeCloseTo(0.2, 10);
		expect(p.t).toBeGreaterThan(0);
		expect(p.t).toBeLessThan(1);
		expect(p.d).toBeCloseTo(0.05, 10);
	});

	it('reaches the closing edge of a ring, running from the last vertex back to the first', () => {
		const doc = makeDoc({ entities: [area('a', SQUARE())] });
		const p = pick(doc, v(-0.05, 8), { tolerance: 0.2 });
		if (p?.part !== 'edge') throw new Error('expected an edge hit');
		expect(p.index).toBe(3);
		// Edge 3 runs (0,10) to (0,0), so y = 8 sits a fifth of the way along.
		expect(p.t).toBeCloseTo(0.2, 10);
	});

	it('leaves an open polyline without a closing edge', () => {
		const doc = makeDoc({ entities: [path('p', [v(0, 0), v(10, 0), v(10, 10)], 0.1)] });
		// Sits on the line a wrongly closed spine would run from (10,10) back to (0,0).
		expect(pick(doc, v(5, 5.05), { tolerance: 0.2 })).toBeNull();
		expect(pick(doc, v(5, 0.05), { tolerance: 0.2 })).toMatchObject({ part: 'edge', index: 0 });
	});

	it('picks the body of a wide path away from its spine', () => {
		const doc = makeDoc({ entities: [path('p', [v(0, 0), v(10, 0)], 2)] });
		expect(pick(doc, v(5, 0.8), { tolerance: 0.2 })).toMatchObject({ part: 'body' });
	});
});

describe('point-like entities', () => {
	it('picks a plant exactly at the tolerance and misses just outside it', () => {
		const doc = makeDoc({ entities: [plant('p', v(0, 0))] });
		expect(pick(doc, v(0.2, 0), { tolerance: 0.2 })?.entity.id).toBe('p');
		expect(pick(doc, v(0.25, 0), { tolerance: 0.2 })).toBeNull();
	});

	it('exposes a single vertex at index 0', () => {
		const doc = makeDoc({ entities: [label('l', v(3, 3))] });
		const hits = pickAll(doc, v(3, 3), { tolerance: 0.2 });
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ part: 'vertex', index: 0 });
	});

	it('beats a fill underneath it', () => {
		const doc = makeDoc({ entities: [area('lawn', SQUARE()), plant('p', v(5, 5))] });
		expect(pick(doc, v(5.1, 5), { tolerance: 0.2 })?.entity.id).toBe('p');
	});
});

describe('holes', () => {
	it('does not report a body hit inside a hole', () => {
		const doc = makeDoc({
			entities: [area('a', SQUARE(), 'open', [[v(4, 4), v(6, 4), v(6, 6), v(4, 6)]])]
		});
		expect(pick(doc, v(5, 5), { tolerance: 0.2 })).toBeNull();
		expect(pick(doc, v(2, 2), { tolerance: 0.2 })).toMatchObject({ part: 'body' });
	});
});

describe('walls and dimensions', () => {
	it('reports a wall corner as the shared node', () => {
		const doc = makeDoc({
			entities: [wall('w1', 'n1', 'n2'), wall('w2', 'n2', 'n3')],
			nodes: { n1: v(0, 0), n2: v(10, 0), n3: v(10, 10) }
		});
		const p = pick(doc, v(10.05, 0), { tolerance: 0.2 });
		expect(p).toMatchObject({ part: 'node', node: 'n2' });
		expect(p?.entity.id).toBe('w2');
	});

	it('picks a dimension on the line between its two resolved anchors', () => {
		const doc = makeDoc({ entities: [dim('d', v(0, 0), v(10, 0))] });
		const p = pick(doc, v(5, 0.05), { tolerance: 0.2 });
		if (p?.part !== 'edge') throw new Error('expected an edge hit');
		expect(p.index).toBe(0);
		expect(p.t).toBeCloseTo(0.5, 10);
		expect(pick(doc, v(0, 0.05), { tolerance: 0.2 })).toMatchObject({ part: 'vertex', index: 0 });
	});
});

describe('layers', () => {
	it('skips hidden and locked layers, and picks them when respectLayers is false', () => {
		const doc = makeDoc({
			entities: [area('h', SQUARE(), 'hidden'), area('l', SQUARE(), 'locked')]
		});
		expect(pick(doc, v(5, 5), { tolerance: 0.2 })).toBeNull();

		const all = pickAll(doc, v(5, 5), { tolerance: 0.2, respectLayers: false });
		expect(all.map((h) => h.entity.id)).toEqual(['l', 'h']);
	});

	it('skips an entity whose layer does not exist', () => {
		const doc = makeDoc({ entities: [area('a', SQUARE(), 'ghost')] });
		expect(pick(doc, v(5, 5), { tolerance: 0.2 })).toBeNull();
		expect(pick(doc, v(5, 5), { tolerance: 0.2, respectLayers: false })?.entity.id).toBe('a');
	});

	it('skips a locked image even on an open layer', () => {
		const doc = makeDoc({ entities: [image('i', v(0, 0), true)] });
		expect(pick(doc, v(1, 1), { tolerance: 0.2 })).toBeNull();
		expect(pick(doc, v(1, 1), { tolerance: 0.2, respectLayers: false })?.entity.id).toBe('i');
	});
});

describe('filters', () => {
	it('kinds keeps only the listed kinds', () => {
		const doc = makeDoc({ entities: [area('a', SQUARE()), plant('p', v(5, 5))] });
		expect(pick(doc, v(5, 5), { tolerance: 0.2, kinds: new Set(['area']) })?.entity.id).toBe('a');
		expect(pick(doc, v(5, 5), { tolerance: 0.2, kinds: new Set(['plant']) })?.entity.id).toBe('p');
		expect(pick(doc, v(5, 5), { tolerance: 0.2, kinds: new Set(['wall']) })).toBeNull();
	});

	it('exclude drops the named entities', () => {
		const doc = makeDoc({ entities: [area('a', SQUARE()), plant('p', v(5, 5))] });
		expect(pick(doc, v(5, 5), { tolerance: 0.2, exclude: new Set(['p']) })?.entity.id).toBe('a');
		expect(pick(doc, v(5, 5), { tolerance: 0.2, exclude: new Set(['a', 'p']) })).toBeNull();
	});

	it('only restricts the search even when something else is on top', () => {
		const doc = makeDoc({ entities: [area('under', SQUARE()), area('over', SQUARE())] });
		expect(pick(doc, v(5, 5), { tolerance: 0.2, only: new Set(['under']) })?.entity.id).toBe(
			'under'
		);
	});
});

describe('pickAll', () => {
	it('orders hits best first and never repeats an entity', () => {
		const doc = makeDoc({
			entities: [area('under', SQUARE()), area('over', SQUARE()), plant('p', v(0.05, 0.05))]
		});
		const hits = pickAll(doc, v(0.05, 0.05), { tolerance: 0.3 });
		expect(hits.map((h) => h.entity.id)).toEqual(['p', 'over', 'under']);
		expect(new Set(hits.map((h) => h.entity.id)).size).toBe(hits.length);
		expect(hits.map((h) => h.part)).toEqual(['vertex', 'vertex', 'vertex']);
	});

	it('returns one entry per entity even when several parts of it are in range', () => {
		const doc = makeDoc({ entities: [area('a', SQUARE())] });
		const hits = pickAll(doc, v(0.02, 0.02), { tolerance: 0.5 });
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ part: 'vertex', index: 0 });
	});

	it('agrees with pick on the winner', () => {
		const doc = makeDoc({
			entities: [area('a', SQUARE()), area('b', [v(4, 4), v(9, 4), v(9, 9), v(4, 9)])]
		});
		const at = v(6, 6);
		expect(pick(doc, at, { tolerance: 0.2 })).toEqual(pickAll(doc, at, { tolerance: 0.2 })[0]);
	});

	it('is empty far from everything', () => {
		const doc = makeDoc({ entities: [area('a', SQUARE())] });
		expect(pickAll(doc, v(100, 100), { tolerance: 0.2 })).toEqual([]);
	});
});

describe('pickInRect', () => {
	const doc = makeDoc({ entities: [area('a', SQUARE())] });

	it('crossing false needs every vertex inside', () => {
		const half = { min: v(-1, -1), max: v(5, 5) };
		expect(pickInRect(doc, half, { crossing: false })).toEqual([]);
		expect(
			pickInRect(doc, { min: v(-1, -1), max: v(11, 11) }, { crossing: false }).map((e) => e.id)
		).toEqual(['a']);
	});

	it('crossing true takes an entity with one vertex inside', () => {
		const half = { min: v(-1, -1), max: v(5, 5) };
		expect(pickInRect(doc, half, { crossing: true }).map((e) => e.id)).toEqual(['a']);
	});

	it('crossing true takes an entity that only has a segment through the box', () => {
		const slit = { min: v(3, -1), max: v(4, 1) };
		expect(pickInRect(doc, slit, { crossing: true }).map((e) => e.id)).toEqual(['a']);
		expect(pickInRect(doc, slit, { crossing: false })).toEqual([]);
	});

	it('crossing true leaves out a box sitting entirely in the middle of a fill', () => {
		const inner = { min: v(4, 4), max: v(6, 6) };
		expect(pickInRect(doc, inner, { crossing: true })).toEqual([]);
	});

	it('handles a rectangle dragged bottom-right to top-left', () => {
		const backwards = { min: v(11, 11), max: v(-1, -1) };
		expect(pickInRect(doc, backwards, { crossing: false }).map((e) => e.id)).toEqual(['a']);
	});

	it('respects layers and kinds', () => {
		const mixed = makeDoc({
			entities: [area('vis', SQUARE()), area('hid', SQUARE(), 'hidden'), plant('p', v(5, 5))]
		});
		const box = { min: v(-1, -1), max: v(11, 11) };
		expect(pickInRect(mixed, box, { crossing: false }).map((e) => e.id)).toEqual(['vis', 'p']);
		expect(
			pickInRect(mixed, box, { crossing: false, respectLayers: false }).map((e) => e.id)
		).toEqual(['vis', 'hid', 'p']);
		expect(
			pickInRect(mixed, box, { crossing: false, kinds: new Set(['plant']) }).map((e) => e.id)
		).toEqual(['p']);
	});

	it('ignores an entity with no vertices at all', () => {
		const roofs = makeDoc({
			entities: [
				{
					id: 'r',
					k: 'roof',
					layer: 'open',
					over: [],
					type: 'gable',
					pitchDeg: 30,
					ridgeDeg: 0,
					overhang: 0.4
				}
			]
		});
		expect(pickInRect(roofs, { min: v(-99, -99), max: v(99, 99) }, { crossing: false })).toEqual(
			[]
		);
	});
});

describe('pickNode', () => {
	const doc = makeDoc({
		entities: [wall('w', 'n1', 'n2')],
		nodes: { n1: v(0, 0), n2: v(10, 0) }
	});

	it('finds the nearest node inside the tolerance', () => {
		const n = pickNode(doc, v(9.9, 0.05), 0.2);
		expect(n?.node).toBe('n2');
		expect(n?.at).toEqual({ x: 10, y: 0 });
		expect(n?.d).toBeCloseTo(Math.hypot(0.1, 0.05), 10);
	});

	it('returns null past the tolerance', () => {
		expect(pickNode(doc, v(5, 0), 0.2)).toBeNull();
	});

	it('does not hand back the live node object', () => {
		const n = pickNode(doc, v(0, 0), 0.2);
		if (!n) throw new Error('expected a node');
		n.at.x = 99;
		expect(doc.nodes.n1).toEqual({ x: 0, y: 0 });
	});
});

describe('pickPlot', () => {
	const doc = makeDoc({ boundary: SQUARE() });

	it('finds a boundary vertex', () => {
		const p = pickPlot(doc, v(10.05, 10.05), 0.2);
		expect(p).toMatchObject({ part: 'vertex', index: 2 });
		expect(p?.at).toEqual({ x: 10, y: 10 });
	});

	it('finds a mid-edge point with its parameter', () => {
		const p = pickPlot(doc, v(10.05, 4), 0.2);
		if (p?.part !== 'edge') throw new Error('expected an edge hit');
		expect(p.index).toBe(1);
		expect(p.t).toBeCloseTo(0.4, 10);
		expect(p.at).toEqual({ x: 10, y: 4 });
		expect(p.d).toBeCloseTo(0.05, 10);
	});

	it('reaches the closing edge of the boundary', () => {
		const p = pickPlot(doc, v(-0.05, 3), 0.2);
		if (p?.part !== 'edge') throw new Error('expected an edge hit');
		expect(p.index).toBe(3);
		expect(p.t).toBeCloseTo(0.7, 10);
	});

	it('prefers a vertex to the edges that meet there', () => {
		expect(pickPlot(doc, v(0.02, 0.02), 0.2)).toMatchObject({ part: 'vertex', index: 0 });
	});

	it('returns null with no boundary, or far from one', () => {
		expect(pickPlot(makeDoc({}), v(0, 0), 0.2)).toBeNull();
		expect(pickPlot(doc, v(5, 5), 0.2)).toBeNull();
	});
});
