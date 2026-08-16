import { describe, expect, test } from 'vitest';
import { createDoc } from '../doc/doc.js';
import type { AreaEntity, Doc, Entity, LineEntity } from '../doc/types.js';
import { angle, dist, fromAngle, v, type Vec2 } from './vec2.js';
import {
	constrain,
	defaultSnapSettings,
	snap,
	type SnapContext,
	type SnapKind,
	type SnapSettings
} from './snap.js';

const area = (id: string, ring: Vec2[]): AreaEntity => ({
	id,
	layer: 'surfaces',
	k: 'area',
	mat: { id: 'grass' },
	ring
});

const line = (id: string, spine: Vec2[]): LineEntity => ({
	id,
	layer: 'structures',
	k: 'line',
	style: { id: 'fence' },
	spine,
	height: 1,
	thickness: 0.1
});

function docWith(...entities: Entity[]): Doc {
	const d = createDoc();
	d.entities = entities;
	return d;
}

function settings(over: Partial<SnapSettings> = {}, off: SnapKind[] = []): SnapSettings {
	const s = { ...defaultSnapSettings(), ...over };
	s.toggles = { ...s.toggles };
	for (const k of off) s.toggles[k] = false;
	return s;
}

const noCtx: SnapContext = {};

const deg = (rad: number): number => (rad * 180) / Math.PI;

describe('priority beats proximity', () => {
	test('a vertex just inside tolerance wins over a nearer grid point', () => {
		const doc = docWith(area('a1', [v(0.28, 0), v(5, 0), v(5, 4), v(0.28, 4)]));
		const res = snap(doc, v(0.3, 0.0), noCtx, settings({ tolerance: 0.1, grid: 0.1 }));

		expect(res.kind).toBe('vertex');
		expect(res.at).toEqual({ x: 0.28, y: 0 });
		expect(res.ref).toEqual({ entity: 'a1', index: 0 });
		expect(res.d).toBeCloseTo(0.02, 12);
	});

	test('a vertex just outside tolerance is not taken', () => {
		const doc = docWith(area('a1', [v(0, 0), v(5, 0), v(5, 4), v(0, 4)]));
		const res = snap(doc, v(0.17, 0), noCtx, settings({ tolerance: 0.1, grid: 0.1 }));

		expect(res.kind).toBe('grid');
		expect(res.at).toEqual({ x: 0.2, y: 0 });
	});
});

describe('point families', () => {
	test('midpoint reports the entity and the segment index', () => {
		const doc = docWith(area('bed', [v(0, 0), v(4, 0), v(4, 3), v(0, 3)]));
		const res = snap(doc, v(2.02, 0.01), noCtx, settings({ tolerance: 0.1 }, ['grid']));

		expect(res.kind).toBe('midpoint');
		expect(res.at).toEqual({ x: 2, y: 0 });
		expect(res.ref).toEqual({ entity: 'bed', index: 0 });
		expect(res.guides).toEqual([{ g: 'tick', at: { x: 2, y: 0 } }]);
	});

	test('centre of a closed ring uses the centroid', () => {
		const doc = docWith(area('bed', [v(0, 0), v(4, 0), v(4, 3), v(0, 3)]));
		const res = snap(doc, v(2.03, 1.52), noCtx, settings({ tolerance: 0.1 }, ['grid']));

		expect(res.kind).toBe('centre');
		expect(res.at.x).toBeCloseTo(2, 12);
		expect(res.at.y).toBeCloseTo(1.5, 12);
	});

	test('an excluded entity offers nothing, not even its midpoint', () => {
		const doc = docWith(area('bed', [v(0, 0), v(4, 0), v(4, 3), v(0, 3)]));
		const res = snap(
			doc,
			v(2.02, 0.01),
			{ exclude: new Set(['bed']) },
			settings({ tolerance: 0.1 }, ['grid'])
		);

		expect(res.kind).toBe('free');
	});

	test('a wall vertex resolves to its node, not to the wall entity', () => {
		const doc = createDoc();
		doc.nodes = { 'node-1': v(1, 1), 'node-2': v(6, 1) };
		doc.entities = [
			{
				id: 'w1',
				layer: 'structures',
				k: 'wall',
				a: 'node-1',
				b: 'node-2',
				thickness: 0.2,
				height: 2.4,
				openings: []
			}
		];
		const res = snap(doc, v(1.02, 1.01), noCtx, settings({ tolerance: 0.1 }, ['grid']));

		expect(res.kind).toBe('vertex');
		expect(res.ref).toEqual({ node: 'node-1' });
	});

	test('ctx.extra points snap as vertices', () => {
		const res = snap(
			createDoc(),
			v(3.01, 4.02),
			{ extra: [v(1, 1), v(3, 4)] },
			settings({ tolerance: 0.1 }, ['grid'])
		);

		expect(res.kind).toBe('vertex');
		expect(res.at).toEqual({ x: 3, y: 4 });
		expect(res.ref).toEqual({ index: 1 });
	});
});

describe('reference families', () => {
	test('perpendicular drops a foot from ctx.from onto a nearby edge', () => {
		const doc = docWith(area('bed', [v(0, 0), v(4, 0), v(4, 3), v(0, 3)]));
		const res = snap(doc, v(1.03, 0.02), { from: v(1, 3) }, settings({ tolerance: 0.1 }, ['grid']));

		expect(res.kind).toBe('perpendicular');
		expect(res.at.x).toBeCloseTo(1, 12);
		expect(res.at.y).toBeCloseTo(0, 12);
		expect(res.guides.length).toBeLessThanOrEqual(3);
	});

	test('extension lands on the infinite ray well beyond the previous segment', () => {
		const res = snap(
			createDoc(),
			v(9, 0.03),
			{ from: v(2, 0), prevDir: v(1, 0) },
			settings({ tolerance: 0.1 }, ['grid'])
		);

		expect(res.kind).toBe('extension');
		expect(res.at.x).toBeCloseTo(9, 12);
		expect(res.at.y).toBeCloseTo(0, 12);
	});

	test('extension does not fire behind ctx.from', () => {
		const res = snap(
			createDoc(),
			v(-4, 0.02),
			{ from: v(2, 0), prevDir: v(1, 0) },
			settings({ tolerance: 0.1, angleStepDeg: 15 }, ['grid', 'angle'])
		);

		expect(res.kind).toBe('free');
	});

	test('two crossing edges snap to their intersection', () => {
		const doc = docWith(line('h', [v(0, 0), v(12, 0)]), line('v', [v(5, -4), v(5, 6)]));
		const res = snap(doc, v(5.02, 0.03), noCtx, settings({ tolerance: 0.1 }, ['grid']));

		expect(res.kind).toBe('intersection');
		expect(res.at.x).toBeCloseTo(5, 12);
		expect(res.at.y).toBeCloseTo(0, 12);
	});

	test('tangent grazes a ring where the vertex snap is switched off', () => {
		const doc = docWith(area('bed', [v(0, 0), v(4, 0), v(4, 4), v(0, 4)]));
		const res = snap(
			doc,
			v(4.03, 0.02),
			{ from: v(10, 2) },
			settings({ tolerance: 0.1 }, ['grid', 'vertex', 'endpoint'])
		);

		expect(res.kind).toBe('tangent');
		expect(res.at).toEqual({ x: 4, y: 0 });
	});
});

describe('angle lock', () => {
	test('locks to exact multiples of the step measured from prevDir, keeping the raw distance', () => {
		const from = v(0, 0);
		const prevDir = fromAngle((20 * Math.PI) / 180);
		const raw = fromAngle((43 * Math.PI) / 180, 4);
		const res = snap(createDoc(), raw, { from, prevDir }, settings({ tolerance: 0.6 }, ['grid']));

		expect(res.kind).toBe('angle');
		expect(dist(from, res.at)).toBeCloseTo(4, 12);

		const rel = deg(angle(res.at) - angle(prevDir));
		expect(rel).toBeCloseTo(30, 9);
		expect(Math.abs(rel / 15 - Math.round(rel / 15))).toBeLessThan(1e-9);
	});

	test('without prevDir the step is measured from east', () => {
		const raw = fromAngle((28 * Math.PI) / 180, 3);
		const res = snap(createDoc(), raw, { from: v(0, 0) }, settings({ tolerance: 0.6 }, ['grid']));

		expect(res.kind).toBe('angle');
		expect(deg(angle(res.at))).toBeCloseTo(30, 9);
	});

	test('a raw point too far off any step is not angle locked', () => {
		const raw = fromAngle((7.5 * Math.PI) / 180, 4);
		const res = snap(createDoc(), raw, { from: v(0, 0) }, settings({ tolerance: 0.1 }, ['grid']));

		expect(res.kind).toBe('free');
	});
});

describe('ortho', () => {
	test('a nearly diagonal point still collapses onto one axis', () => {
		const from = v(0, 0);
		const horizontal = snap(
			createDoc(),
			v(1.0, 0.99),
			{ from, ortho: true },
			settings({ tolerance: 0.1 }, ['grid'])
		);
		expect(horizontal.at).toEqual({ x: 1.0, y: 0 });

		const vertical = snap(
			createDoc(),
			v(0.99, 1.0),
			{ from, ortho: true },
			settings({ tolerance: 0.1 }, ['grid'])
		);
		expect(vertical.at).toEqual({ x: 0, y: 1.0 });
	});

	test('a vertex on the axis still wins, one off the axis does not', () => {
		const doc = docWith(area('bed', [v(2, 0), v(6, 0), v(6, 3), v(2, 3)]));
		const onAxis = snap(
			doc,
			v(2.03, 0.04),
			{ from: v(0, 0), ortho: true },
			settings({ tolerance: 0.1 }, ['grid'])
		);
		expect(onAxis.kind).toBe('vertex');
		expect(onAxis.at).toEqual({ x: 2, y: 0 });

		const offAxis = snap(
			doc,
			v(6.02, 3.01),
			{ from: v(0, 0), ortho: true },
			settings({ tolerance: 0.1 }, ['grid'])
		);
		expect(offAxis.kind).not.toBe('vertex');
		expect(offAxis.at).toEqual({ x: 6.02, y: 0 });
	});

	test('ortho beats a grid point that is not on the axis', () => {
		const res = snap(
			createDoc(),
			v(1.03, 0.4),
			{ from: v(0, 0), ortho: true },
			settings({ tolerance: 0.1, grid: 0.1 })
		);

		expect(res.at).toEqual({ x: 1.03, y: 0 });
	});
});

describe('grid', () => {
	test('rounding at 0.1 m leaves no floating point noise', () => {
		const res = snap(createDoc(), v(4.32, 2.67), noCtx, settings({ tolerance: 0.1, grid: 0.1 }));

		expect(res.kind).toBe('grid');
		expect(res.at.x).toBe(4.3);
		expect(res.at.y).toBe(2.7);
	});

	test('a point rounding towards zero does not come back as negative zero', () => {
		const res = snap(createDoc(), v(-0.02, 0.01), noCtx, settings({ tolerance: 0.1, grid: 0.1 }));

		expect(Object.is(res.at.x, 0)).toBe(true);
		expect(Object.is(res.at.y, 0)).toBe(true);
	});
});

describe('toggles', () => {
	test('disabling midpoint skips that family entirely', () => {
		const doc = docWith(area('bed', [v(0, 0), v(4, 0), v(4, 3), v(0, 3)]));
		const res = snap(doc, v(2.02, 0.01), noCtx, settings({ tolerance: 0.1 }, ['grid', 'midpoint']));

		expect(res.kind).toBe('free');
	});

	test('disabling vertex leaves the midpoint family working', () => {
		const doc = docWith(area('bed', [v(0, 0), v(4, 0), v(4, 3), v(0, 3)]));
		const res = snap(doc, v(0.02, 0.01), noCtx, settings({ tolerance: 0.1 }, ['grid', 'vertex']));

		expect(res.kind).not.toBe('vertex');
	});

	test('disabling grid stops the rounding', () => {
		const res = snap(createDoc(), v(4.32, 2.67), noCtx, settings({ tolerance: 0.1 }, ['grid']));

		expect(res.kind).toBe('free');
		expect(res.at).toEqual({ x: 4.32, y: 2.67 });
		expect(res.d).toBe(0);
	});
});

describe('constrain', () => {
	test('length and angle together produce an exact point', () => {
		const from = v(1, 1);
		const a = Math.PI / 6;
		const at = constrain(from, v(9, -3), { length: 5, angleRad: a });

		expect(dist(from, at)).toBeCloseTo(5, 12);
		expect(angle({ x: at.x - from.x, y: at.y - from.y })).toBeCloseTo(a, 12);
	});

	test('length alone keeps the raw direction', () => {
		const from = v(1, 1);
		const raw = v(4, 5);
		const at = constrain(from, raw, { length: 10 });

		expect(dist(from, at)).toBeCloseTo(10, 12);
		expect(angle({ x: at.x - from.x, y: at.y - from.y })).toBeCloseTo(
			angle({ x: raw.x - from.x, y: raw.y - from.y }),
			12
		);
	});

	test('angle alone keeps the raw distance', () => {
		const from = v(1, 1);
		const raw = v(4, 5);
		const at = constrain(from, raw, { angleRad: 0 });

		expect(dist(from, at)).toBeCloseTo(5, 12);
		expect(at.y).toBeCloseTo(1, 12);
	});
});

test('an empty document with grid off returns free at the raw point', () => {
	const raw = v(3.14159, -2.71828);
	const res = snap(createDoc(), raw, noCtx, settings({ tolerance: 0.25 }, ['grid']));

	expect(res.kind).toBe('free');
	expect(res.at).toEqual({ x: raw.x, y: raw.y });
	expect(res.d).toBe(0);
	expect(res.guides).toEqual([]);
});

test('guides never exceed three hints', () => {
	const doc = docWith(area('bed', [v(0, 0), v(4, 0), v(4, 3), v(0, 3)]));
	const probes: Vec2[] = [v(0.01, 0.01), v(2.01, 0.01), v(2.01, 1.51), v(4.02, 1.5)];
	for (const p of probes) {
		const res = snap(doc, p, { from: v(-3, 1.5), prevDir: v(1, 0) }, settings({ tolerance: 0.2 }));
		expect(res.guides.length).toBeLessThanOrEqual(3);
	}
});
