import { describe, expect, it } from 'vitest';
import { createDoc } from './doc.js';
import type {
	AreaEntity,
	DimEntity,
	Doc,
	Entity,
	LineEntity,
	PlantEntity,
	WallEntity
} from './types.js';
import { fromAngle, type Vec2 } from '../geom/vec2.js';
import {
	anchorAt,
	dimDistance,
	dimGeometry,
	formatAngle,
	formatArea,
	formatBearing,
	formatLength,
	formatRing,
	formatSegment,
	offsetFromPoint,
	uprightAngle
} from './dimension.js';

const THIN = '\u2009';
const v = (x: number, y: number): Vec2 => ({ x, y });

function docWith(...entities: Entity[]): Doc {
	const d = createDoc();
	d.entities.push(...entities);
	return d;
}

function freeDim(a: Vec2, b: Vec2, offset: number): DimEntity {
	return {
		id: 'dim-1',
		layer: 'annotation',
		k: 'dim',
		from: { k: 'free', at: a },
		to: { k: 'free', at: b },
		offset
	};
}

function square(id = 'area-1'): AreaEntity {
	return {
		id,
		layer: 'surfaces',
		k: 'area',
		mat: { id: 'grass' },
		ring: [v(0, 0), v(4, 0), v(4, 4), v(0, 4)]
	};
}

function polyline(id = 'line-1'): LineEntity {
	return {
		id,
		layer: 'surfaces',
		k: 'line',
		style: { id: 'fence' },
		spine: [v(0, 0), v(10, 0)],
		height: 1,
		thickness: 0.1
	};
}

/** Every number reachable in a returned structure, so a NaN cannot hide in a corner. */
function numbersIn(value: unknown): number[] {
	if (typeof value === 'number') return [value];
	if (Array.isArray(value)) return value.flatMap(numbersIn);
	if (value && typeof value === 'object') return Object.values(value).flatMap(numbersIn);
	return [];
}

describe('dimGeometry', () => {
	it('measures and formats a 4,25 m span between two free points', () => {
		const doc = createDoc();
		const g = dimGeometry(doc, freeDim(v(1, 1), v(5.25, 1), 1));
		expect(g).not.toBeNull();
		if (!g) return;
		expect(g.value).toBeCloseTo(4.25, 12);
		expect(formatLength(g.value)).toBe('4,25 m');
		expect(g.cramped).toBe(false);
	});

	it('puts the dimension line on the left of travel for a positive offset', () => {
		const doc = createDoc();
		const g = dimGeometry(doc, freeDim(v(0, 0), v(4, 0), 2));
		if (!g) throw new Error('expected geometry');
		expect(g.lineA).toEqual(v(0, 2));
		expect(g.lineB).toEqual(v(4, 2));
	});

	it('flips the line and the witness lines when the offset changes sign', () => {
		const doc = createDoc();
		const pos = dimGeometry(doc, freeDim(v(0, 0), v(4, 0), 2));
		const neg = dimGeometry(doc, freeDim(v(0, 0), v(4, 0), -2));
		if (!pos || !neg) throw new Error('expected geometry');

		expect(pos.lineA.y).toBeCloseTo(2, 12);
		expect(neg.lineA.y).toBeCloseTo(-2, 12);
		expect(pos.lineB.y).toBeCloseTo(2, 12);
		expect(neg.lineB.y).toBeCloseTo(-2, 12);

		// Witness runs the same way as the line, and overshoots past it on that side.
		expect(pos.witnessA[0].y).toBeGreaterThan(0);
		expect(pos.witnessA[1].y).toBeGreaterThan(2);
		expect(neg.witnessA[0].y).toBeLessThan(0);
		expect(neg.witnessA[1].y).toBeLessThan(-2);
		expect(neg.witnessB[1].y).toBeCloseTo(-pos.witnessB[1].y, 12);
		expect(pos.witnessA[0].x).toBeCloseTo(0, 12);
		expect(pos.witnessB[0].x).toBeCloseTo(4, 12);
	});

	it('starts witness lines clear of the measured point', () => {
		const doc = createDoc();
		const g = dimGeometry(doc, freeDim(v(0, 0), v(4, 0), 2));
		if (!g) throw new Error('expected geometry');
		expect(g.witnessA[0].y).toBeGreaterThan(0);
		expect(g.witnessA[0].y).toBeLessThan(0.5);
		expect(g.a).toEqual(v(0, 0));
	});

	it('never reads upside down, whichever way the dimension runs', () => {
		const doc = createDoc();
		const half = Math.PI / 2;
		for (let deg = 0; deg < 360; deg += 5) {
			const rad = (deg * Math.PI) / 180;
			const g = dimGeometry(doc, freeDim(v(0, 0), fromAngle(rad, 3), 1));
			if (!g) throw new Error('expected geometry');
			expect(g.textRot).toBeLessThanOrEqual(half + 1e-9);
			expect(g.textRot).toBeGreaterThan(-half - 1e-9);
			// Text still reads along the measured line, forwards or backwards.
			const t = fromAngle(g.textRot);
			const d = fromAngle(rad);
			expect(Math.abs(t.x * d.x + t.y * d.y)).toBeCloseTo(1, 9);
		}
	});

	it('keeps the text position when it flips the reading direction', () => {
		const doc = createDoc();
		const ltr = dimGeometry(doc, freeDim(v(0, 0), v(4, 0), 0));
		const rtl = dimGeometry(doc, freeDim(v(4, 0), v(0, 0), 0));
		if (!ltr || !rtl) throw new Error('expected geometry');
		expect(rtl.textRot).toBeCloseTo(0, 12);
		expect(rtl.textAt.x).toBeCloseTo(ltr.textAt.x, 12);
		expect(rtl.textAt.y).toBeCloseTo(ltr.textAt.y, 12);
	});

	it('returns null when an anchor points at a deleted entity', () => {
		const doc = docWith(square());
		const dim: DimEntity = {
			id: 'dim-1',
			layer: 'annotation',
			k: 'dim',
			from: { k: 'vertex', e: 'area-1', i: 0 },
			to: { k: 'vertex', e: 'area-1', i: 1 },
			offset: 1
		};
		expect(dimGeometry(doc, dim)).not.toBeNull();
		doc.entities = [];
		expect(() => dimGeometry(doc, dim)).not.toThrow();
		expect(dimGeometry(doc, dim)).toBeNull();
	});

	it('returns null when only one anchor is gone', () => {
		const doc = docWith(square());
		const dim: DimEntity = {
			id: 'dim-1',
			layer: 'annotation',
			k: 'dim',
			from: { k: 'vertex', e: 'area-1', i: 0 },
			to: { k: 'vertex', e: 'ghost', i: 0 },
			offset: 1
		};
		expect(dimGeometry(doc, dim)).toBeNull();
	});

	it('returns null when a vertex index no longer exists', () => {
		const doc = docWith(square());
		const dim: DimEntity = {
			id: 'dim-1',
			layer: 'annotation',
			k: 'dim',
			from: { k: 'vertex', e: 'area-1', i: 0 },
			to: { k: 'vertex', e: 'area-1', i: 9 },
			offset: 1
		};
		expect(dimGeometry(doc, dim)).toBeNull();
	});

	it('follows a vertex when the entity moves', () => {
		const area = square();
		const doc = docWith(area);
		const dim: DimEntity = {
			id: 'dim-1',
			layer: 'annotation',
			k: 'dim',
			from: { k: 'vertex', e: 'area-1', i: 0 },
			to: { k: 'vertex', e: 'area-1', i: 1 },
			offset: 1
		};
		const before = dimGeometry(doc, dim);
		if (!before) throw new Error('expected geometry');
		expect(before.value).toBeCloseTo(4, 12);

		area.ring[1] = v(10, 0);
		const after = dimGeometry(doc, dim);
		if (!after) throw new Error('expected geometry');
		expect(after.value).toBeCloseTo(10, 12);
		expect(after.b).toEqual(v(10, 0));
		// The first read must not have handed out a live reference into the document.
		expect(before.b).toEqual(v(4, 0));
	});

	it('sits at the midpoint of an edge anchor, closing edge included', () => {
		const doc = docWith(square());
		const dim: DimEntity = {
			id: 'dim-1',
			layer: 'annotation',
			k: 'dim',
			from: { k: 'edge', e: 'area-1', i: 0, t: 0.5 },
			to: { k: 'edge', e: 'area-1', i: 3, t: 0.5 },
			offset: 0
		};
		const g = dimGeometry(doc, dim);
		if (!g) throw new Error('expected geometry');
		expect(g.a).toEqual(v(2, 0));
		expect(g.b).toEqual(v(0, 2));
	});

	it('rejects an edge index past the last edge of a closed ring', () => {
		const doc = docWith(square());
		const dim: DimEntity = {
			id: 'dim-1',
			layer: 'annotation',
			k: 'dim',
			from: { k: 'edge', e: 'area-1', i: 0, t: 0.5 },
			to: { k: 'edge', e: 'area-1', i: 4, t: 0.5 },
			offset: 0
		};
		expect(dimGeometry(doc, dim)).toBeNull();
	});

	it('produces no NaN for a zero-length dimension', () => {
		const doc = createDoc();
		const g = dimGeometry(doc, freeDim(v(3, 3), v(3, 3), 1.5));
		if (!g) throw new Error('expected geometry');
		expect(g.value).toBe(0);
		for (const n of numbersIn(g)) expect(Number.isFinite(n)).toBe(true);
		expect(g.cramped).toBe(true);
		expect(g.lineA).toEqual(g.lineB);
	});

	it('is cramped only when the span is shorter than the text', () => {
		const doc = createDoc();
		const short = dimGeometry(doc, freeDim(v(0, 0), v(0.5, 0), 1));
		const wide = dimGeometry(doc, freeDim(v(0, 0), v(0.5, 0), 1), { textWidth: 0.2 });
		if (!short || !wide) throw new Error('expected geometry');
		expect(short.cramped).toBe(true);
		expect(wide.cramped).toBe(false);
	});

	it('follows a wall node through the node anchor', () => {
		const doc = createDoc();
		doc.nodes['node-1'] = v(0, 0);
		doc.nodes['node-2'] = v(6, 0);
		const wall: WallEntity = {
			id: 'wall-1',
			layer: 'structures',
			k: 'wall',
			a: 'node-1',
			b: 'node-2',
			thickness: 0.3,
			height: 2.5,
			openings: []
		};
		doc.entities.push(wall);
		const dim: DimEntity = {
			id: 'dim-1',
			layer: 'annotation',
			k: 'dim',
			from: { k: 'node', n: 'node-1' },
			to: { k: 'node', n: 'node-2' },
			offset: 1
		};
		doc.nodes['node-2'] = v(9, 0);
		const g = dimGeometry(doc, dim);
		if (!g) throw new Error('expected geometry');
		expect(g.value).toBeCloseTo(9, 12);
	});
});

describe('uprightAngle', () => {
	it('leaves an already upright angle alone', () => {
		expect(uprightAngle(0)).toBeCloseTo(0, 12);
		expect(uprightAngle(Math.PI / 4)).toBeCloseTo(Math.PI / 4, 12);
		expect(uprightAngle(-Math.PI / 4)).toBeCloseTo(-Math.PI / 4, 12);
	});

	it('keeps 90 degrees reading upward and turns 270 into 90', () => {
		expect(uprightAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
		expect(uprightAngle((3 * Math.PI) / 2)).toBeCloseTo(Math.PI / 2, 12);
		expect(uprightAngle(-Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
	});

	it('turns 180 degrees the right way up', () => {
		expect(uprightAngle(Math.PI)).toBeCloseTo(0, 12);
		expect(uprightAngle(-Math.PI)).toBeCloseTo(0, 12);
	});

	it('normalises angles far outside one turn', () => {
		const half = Math.PI / 2;
		for (let deg = -1080; deg <= 1080; deg += 7) {
			const out = uprightAngle((deg * Math.PI) / 180);
			expect(out).toBeLessThanOrEqual(half + 1e-9);
			expect(out).toBeGreaterThan(-half - 1e-9);
		}
	});

	it('is idempotent', () => {
		for (let deg = 0; deg < 360; deg += 3) {
			const once = uprightAngle((deg * Math.PI) / 180);
			expect(uprightAngle(once)).toBeCloseTo(once, 12);
		}
	});
});

describe('dimDistance', () => {
	it('is zero on the dimension line and grows away from it', () => {
		const doc = createDoc();
		const g = dimGeometry(doc, freeDim(v(0, 0), v(4, 0), 2));
		if (!g) throw new Error('expected geometry');
		expect(dimDistance(g, v(2, 2))).toBeCloseTo(0, 12);
		expect(dimDistance(g, v(2, 5))).toBeGreaterThan(dimDistance(g, v(2, 3)));
		expect(dimDistance(g, v(2, 5))).toBeLessThan(3);
	});

	it('hits the witness lines, not just the dimension line', () => {
		const doc = createDoc();
		const g = dimGeometry(doc, freeDim(v(0, 0), v(4, 0), 2));
		if (!g) throw new Error('expected geometry');
		expect(dimDistance(g, v(0, 1))).toBeCloseTo(0, 12);
		expect(dimDistance(g, v(4, 1))).toBeCloseTo(0, 12);
	});
});

describe('offsetFromPoint', () => {
	it('is positive to the left of travel and negative to the right', () => {
		expect(offsetFromPoint(v(0, 0), v(4, 0), v(2, 3))).toBeCloseTo(3, 12);
		expect(offsetFromPoint(v(0, 0), v(4, 0), v(2, -3))).toBeCloseTo(-3, 12);
		expect(offsetFromPoint(v(4, 0), v(0, 0), v(2, 3))).toBeCloseTo(-3, 12);
	});

	it('round-trips through dimGeometry', () => {
		const doc = createDoc();
		const a = v(1, 1);
		const b = v(4, 5);
		const off = offsetFromPoint(a, b, v(-1, 3));
		const g = dimGeometry(doc, freeDim(a, b, off));
		if (!g) throw new Error('expected geometry');
		// The cursor should land on the dimension line it just defined.
		expect(dimDistance(g, v(-1, 3))).toBeCloseTo(0, 9);
	});

	it('does not produce NaN for a zero-length base', () => {
		expect(Number.isFinite(offsetFromPoint(v(2, 2), v(2, 2), v(5, 7)))).toBe(true);
	});
});

describe('anchorAt', () => {
	it('prefers a vertex over the edge it sits on', () => {
		const doc = docWith(square());
		expect(anchorAt(doc, v(0.05, 0.05), 0.5)).toEqual({ k: 'vertex', e: 'area-1', i: 0 });
	});

	it('falls back to an edge with its parameter, closing edge included', () => {
		const doc = docWith(square());
		const mid = anchorAt(doc, v(2, 0.05), 0.5);
		expect(mid).toEqual({ k: 'edge', e: 'area-1', i: 0, t: 0.5 });
		const closing = anchorAt(doc, v(-0.05, 2), 0.5);
		expect(closing).toEqual({ k: 'edge', e: 'area-1', i: 3, t: 0.5 });
	});

	it('gives a wall corner as a node, so both walls follow the drag', () => {
		const doc = createDoc();
		doc.nodes['node-1'] = v(0, 0);
		doc.nodes['node-2'] = v(6, 0);
		const wall: WallEntity = {
			id: 'wall-1',
			layer: 'structures',
			k: 'wall',
			a: 'node-1',
			b: 'node-2',
			thickness: 0.3,
			height: 2.5,
			openings: []
		};
		doc.entities.push(wall);
		expect(anchorAt(doc, v(0.05, 0), 0.5)).toEqual({ k: 'node', n: 'node-1' });
		expect(anchorAt(doc, v(3, 0.05), 0.5)).toEqual({ k: 'edge', e: 'wall-1', i: 0, t: 0.5 });
	});

	it('ignores an entity on a locked or hidden layer', () => {
		const doc = docWith(square());
		const surfaces = doc.layers.find((l) => l.id === 'surfaces');
		if (!surfaces) throw new Error('missing layer');
		surfaces.locked = true;
		expect(anchorAt(doc, v(0.05, 0.05), 0.5)).toEqual({ k: 'free', at: v(0.05, 0.05) });
		surfaces.locked = false;
		surfaces.visible = false;
		expect(anchorAt(doc, v(0.05, 0.05), 0.5)).toEqual({ k: 'free', at: v(0.05, 0.05) });
	});

	it('respects the exclude set', () => {
		const doc = docWith(square());
		expect(anchorAt(doc, v(0.05, 0.05), 0.5, new Set(['area-1']))).toEqual({
			k: 'free',
			at: v(0.05, 0.05)
		});
	});

	it('gives a free anchor outside the tolerance', () => {
		const doc = docWith(square());
		expect(anchorAt(doc, v(-5, -5), 0.5)).toEqual({ k: 'free', at: v(-5, -5) });
	});

	it('picks the nearest of two candidate vertices', () => {
		const plant: PlantEntity = {
			id: 'plant-1',
			layer: 'planting',
			k: 'plant',
			species: 'malus',
			at: v(0.3, 0),
			rot: 0,
			sizeJitter: 0,
			plantedYear: 2020
		};
		const doc = docWith(square(), plant);
		expect(anchorAt(doc, v(0.28, 0), 1)).toEqual({ k: 'vertex', e: 'plant-1', i: 0 });
	});

	it('never anchors to another dimension', () => {
		const doc = docWith(freeDim(v(0, 0), v(4, 0), 1));
		expect(anchorAt(doc, v(0, 0), 0.5)).toEqual({ k: 'free', at: v(0, 0) });
	});

	it('produces an anchor that resolves back to the point it was found at', () => {
		const doc = docWith(polyline());
		const a = anchorAt(doc, v(4, 0.02), 0.5);
		expect(a).toEqual({ k: 'edge', e: 'line-1', i: 0, t: 0.4 });
	});
});

describe('formatLength', () => {
	it('drops to millimetres under a metre', () => {
		expect(formatLength(0.85)).toBe('850 mm');
		expect(formatLength(0.004)).toBe('4 mm');
		expect(formatLength(0)).toBe('0 mm');
	});

	it('formats metres with a comma and no trailing zeros', () => {
		expect(formatLength(4.25)).toBe('4,25 m');
		expect(formatLength(4)).toBe('4 m');
		expect(formatLength(4.5)).toBe('4,5 m');
		expect(formatLength(4.004)).toBe('4 m');
	});

	it('groups thousands with a thin space', () => {
		expect(formatLength(1234.5)).toBe(`1${THIN}234,5 m`);
		expect(formatLength(1000000)).toBe(`1${THIN}000${THIN}000 m`);
	});

	it('switches unit on the rounded value, not the raw one', () => {
		expect(formatLength(0.9999)).toBe('1 m');
		expect(formatLength(0.9994)).toBe('999 mm');
	});

	it('keeps the sign', () => {
		expect(formatLength(-2.5)).toBe('-2,5 m');
		expect(formatLength(-0.85)).toBe('-850 mm');
	});
});

describe('formatArea', () => {
	it('uses one decimal for small areas', () => {
		expect(formatArea(12.4)).toBe('12,4 m²');
		expect(formatArea(12)).toBe('12 m²');
		expect(formatArea(0.5)).toBe('0,5 m²');
	});

	it('drops decimals and groups thousands for big areas', () => {
		expect(formatArea(1240)).toBe(`1${THIN}240 m²`);
		expect(formatArea(1240.4)).toBe(`1${THIN}240 m²`);
		expect(formatArea(150)).toBe('150 m²');
	});
});

describe('formatAngle', () => {
	it('always shows one decimal', () => {
		expect(formatAngle(Math.PI / 4)).toBe('45,0°');
		expect(formatAngle(0)).toBe('0,0°');
	});

	it('normalises negative and beyond-360 angles', () => {
		expect(formatAngle(-Math.PI / 2)).toBe('270,0°');
		expect(formatAngle(-Math.PI / 4)).toBe('315,0°');
		expect(formatAngle(2 * Math.PI)).toBe('0,0°');
		expect(formatAngle(2 * Math.PI + Math.PI / 4)).toBe('45,0°');
		expect(formatAngle(-4 * Math.PI + Math.PI)).toBe('180,0°');
	});

	it('does not round up into 360', () => {
		expect(formatAngle(-1e-9)).toBe('0,0°');
	});
});

describe('formatBearing', () => {
	const at = (deg: number, off = 0): string => formatBearing((deg * Math.PI) / 180, off);

	it('reads the four cardinals in Swedish', () => {
		expect(at(90)).toBe('N');
		expect(at(0)).toBe('O');
		expect(at(-90)).toBe('S');
		expect(at(180)).toBe('V');
	});

	it('reads the intercardinals', () => {
		expect(at(45)).toBe('NO');
		expect(at(135)).toBe('NV');
		expect(at(-135)).toBe('SV');
		expect(at(-45)).toBe('SO');
		expect(at(67.5)).toBe('NNO');
		expect(at(22.5)).toBe('ONO');
		expect(at(-22.5)).toBe('OSO');
		expect(at(112.5)).toBe('NNV');
	});

	it('wraps cleanly through north', () => {
		expect(at(89)).toBe('N');
		expect(at(91)).toBe('N');
		expect(at(80)).toBe('N');
		expect(at(100)).toBe('N');
		expect(at(450)).toBe('N');
		expect(at(-270)).toBe('N');
	});

	it('turns with a non-zero north offset', () => {
		// North now points along world west, so a direction pointing west reads as N.
		expect(at(180, 90)).toBe('N');
		expect(at(90, 90)).toBe('O');
		expect(at(90, -45)).toBe('NV');
		expect(at(135, 45)).toBe('N');
		expect(at(45, 45)).toBe('O');
	});
});

describe('formatSegment', () => {
	it('reads length and angle of the segment being drawn', () => {
		expect(formatSegment(v(0, 0), v(4.25, 0))).toEqual({ length: '4,25 m', angle: '0,0°' });
		expect(formatSegment(v(0, 0), v(0, 3))).toEqual({ length: '3 m', angle: '90,0°' });
		expect(formatSegment(v(1, 1), v(0, 0))).toEqual({
			length: formatLength(Math.SQRT2),
			angle: '225,0°'
		});
	});

	it('survives a segment with no length yet', () => {
		expect(formatSegment(v(2, 2), v(2, 2))).toEqual({ length: '0 mm', angle: '0,0°' });
	});
});

describe('formatRing', () => {
	it('reads area and perimeter of a closed ring', () => {
		const r = [v(0, 0), v(4, 0), v(4, 4), v(0, 4)];
		expect(formatRing(r)).toEqual({ area: '16 m²', perimeter: '16 m' });
	});

	it('reads a ring still being drawn', () => {
		expect(formatRing([])).toEqual({ area: '0 m²', perimeter: '0 mm' });
		expect(formatRing([v(0, 0)])).toEqual({ area: '0 m²', perimeter: '0 mm' });
		// Two points are a line, not a ring, so the perimeter must not be counted twice.
		expect(formatRing([v(0, 0), v(3, 0)])).toEqual({ area: '0 m²', perimeter: '3 m' });
	});

	it('is unaffected by winding direction', () => {
		const cw = [v(0, 4), v(4, 4), v(4, 0), v(0, 0)];
		expect(formatRing(cw).area).toBe('16 m²');
	});
});
