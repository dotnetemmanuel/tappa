import { describe, expect, it } from 'vitest';
import { createDoc } from '../doc/doc.js';
import { makePlant, makeSpot } from '../doc/factory.js';
import type { Doc } from '../doc/types.js';
import { buildField, heightAt } from './field.js';
import {
	elevationBounds,
	handleAt,
	sectionPoint,
	sectionVertices,
	slopeHandles,
	tiltFactor
} from './section.js';

/** Falls 2 m from west to east, level north to south. */
function slopingPlot(): Doc {
	const doc = createDoc();
	doc.plot.boundary = [
		{ x: 0, y: 0 },
		{ x: 20, y: 0 },
		{ x: 20, y: 20 },
		{ x: 0, y: 20 }
	];
	doc.entities.push(makeSpot({ x: 0, y: 0 }, 0));
	doc.entities.push(makeSpot({ x: 20, y: 0 }, -2));
	doc.entities.push(makeSpot({ x: 0, y: 20 }, 0));
	return doc;
}

describe('slopeHandles', () => {
	it('gives one handle at each end, looking from the south', () => {
		const doc = slopingPlot();
		const field = buildField(doc);
		const [left, right] = slopeHandles(doc, field, 's');
		expect(left.side).toBe('left');
		expect(right.side).toBe('right');
		expect(left.u).toBeLessThan(right.u);
		// West is high, east is low, and the drawing runs west to east from the south.
		expect(left.z).toBeGreaterThan(right.z);
		expect(right.z).toBeLessThan(-1.5);
	});

	it('sits on the section line it stands for, so the number matches what moves', () => {
		const doc = slopingPlot();
		const field = buildField(doc);
		for (const h of slopeHandles(doc, field, 's')) {
			expect(heightAt(field, h.at.x, h.at.y)).toBeCloseTo(h.z, 6);
		}
	});

	it('stays on the middle of the plot even when a ridge stands higher at the edge', () => {
		const doc = slopingPlot();
		doc.entities.push(makeSpot({ x: 10, y: 20 }, 4));
		const field = buildField(doc);
		for (const h of slopeHandles(doc, field, 's')) {
			expect(h.at.y).toBeCloseTo(10, 1);
			expect(h.z).toBeCloseTo(heightAt(field, h.at.x, h.at.y), 6);
		}
	});

	it('binds to a height point standing on the section line', () => {
		const doc = slopingPlot();
		doc.entities.push(makeSpot({ x: 0.5, y: 10 }, 0));
		const field = buildField(doc);
		const [left] = slopeHandles(doc, field, 's');
		const spot = doc.entities.find((e) => e.id === left.spot);
		expect(spot?.k).toBe('spot');
	});

	it('binds to nothing when the only points sit at the far corners', () => {
		const doc = slopingPlot();
		const field = buildField(doc);
		expect(slopeHandles(doc, field, 's').every((h) => h.spot === null)).toBe(true);
	});

	it('leaves the handle unbound where there is no height point close by', () => {
		const doc = createDoc();
		doc.plot.boundary = [
			{ x: 0, y: 0 },
			{ x: 60, y: 0 },
			{ x: 60, y: 20 },
			{ x: 0, y: 20 }
		];
		doc.entities.push(makeSpot({ x: 30, y: 10 }, 1));
		const field = buildField(doc);
		const [left, right] = slopeHandles(doc, field, 's');
		expect(left.spot).toBeNull();
		expect(right.spot).toBeNull();
	});

	it('turns the plot around when you look from another side', () => {
		const doc = slopingPlot();
		const field = buildField(doc);
		const fromSouth = slopeHandles(doc, field, 's');
		const fromNorth = slopeHandles(doc, field, 'n');
		expect(fromSouth[0].z).toBeCloseTo(fromNorth[1].z, 2);
		expect(fromSouth[1].z).toBeCloseTo(fromNorth[0].z, 2);
	});

	it('gives nothing to a document with nothing in it', () => {
		expect(slopeHandles(createDoc(), null, 's')).toEqual([]);
	});
});

describe('elevationBounds', () => {
	it('covers the plot across and leaves room over the highest wall', () => {
		const doc = slopingPlot();
		const field = buildField(doc);
		const b = elevationBounds(doc, field, 's');
		expect(b.min.x).toBeLessThanOrEqual(0);
		expect(b.max.x).toBeGreaterThanOrEqual(20);
		expect(b.min.y).toBeLessThan(-2);
		expect(b.max.y).toBeGreaterThan(0);
	});
});

describe('handleAt', () => {
	it('lands on the section line anywhere along the view, not only at the ends', () => {
		const doc = slopingPlot();
		const field = buildField(doc);
		for (const u of [2, 7, 12, 18]) {
			const h = handleAt(doc, field, 's', u);
			expect(h.side).toBe('along');
			expect(h.u).toBe(u);
			expect(heightAt(field, h.at.x, h.at.y)).toBeCloseTo(h.z, 6);
		}
	});

	it('follows the slope, so the middle sits between the two ends', () => {
		const doc = slopingPlot();
		const field = buildField(doc);
		const [left, right] = slopeHandles(doc, field, 's');
		const middle = handleAt(doc, field, 's', (left.u + right.u) / 2);
		expect(middle.z).toBeLessThan(left.z);
		expect(middle.z).toBeGreaterThan(right.z);
	});

	it('binds to a height point standing where you grabbed, and to none out in the open', () => {
		const doc = slopingPlot();
		doc.entities.push(makeSpot({ x: 10, y: 10 }, 3));
		const field = buildField(doc);
		const onPoint = handleAt(doc, field, 's', 10);
		expect(onPoint.spot).not.toBeNull();
		expect(handleAt(doc, field, 's', 15).spot).toBeNull();
	});

	it('raises the ground where you grabbed it and barely disturbs the rest', () => {
		const doc = slopingPlot();
		const before = buildField(doc);
		const far = handleAt(doc, before, 's', 0);
		doc.entities.push(makeSpot({ x: 12, y: 10 }, 5));
		const after = buildField(doc);
		expect(handleAt(doc, after, 's', 12).z).toBeCloseTo(5, 1);
		// Twelve metres away and five metres up: the rest of the plot may lean, but only slightly.
		expect(Math.abs(handleAt(doc, after, 's', 0).z - far.z)).toBeLessThan(0.25);
	});

	it('leaves a height point exactly where it stands when another one moves', () => {
		const doc = slopingPlot();
		doc.entities.push(makeSpot({ x: 2, y: 10 }, 0.4));
		doc.entities.push(makeSpot({ x: 12, y: 10 }, 5));
		const field = buildField(doc);
		expect(handleAt(doc, field, 's', 2).z).toBeCloseTo(0.4, 2);
	});
});

describe('tiltFactor', () => {
	it('takes the whole tilt at the end you grab and none at the end it pivots on', () => {
		expect(tiltFactor('s', 20, 0, { x: 20, y: 5 })).toBeCloseTo(1, 6);
		expect(tiltFactor('s', 20, 0, { x: 0, y: 5 })).toBeCloseTo(0, 6);
		expect(tiltFactor('s', 20, 0, { x: 10, y: 5 })).toBeCloseTo(0.5, 6);
	});

	it('ramps the same way when you grab the other end', () => {
		expect(tiltFactor('s', 0, 20, { x: 0, y: 5 })).toBeCloseTo(1, 6);
		expect(tiltFactor('s', 0, 20, { x: 20, y: 5 })).toBeCloseTo(0, 6);
		expect(tiltFactor('s', 0, 20, { x: 15, y: 5 })).toBeCloseTo(0.25, 6);
	});

	it('carries a point beyond the ends along the same ramp', () => {
		expect(tiltFactor('s', 20, 0, { x: 30, y: 5 })).toBeCloseTo(1.5, 6);
		expect(tiltFactor('s', 20, 0, { x: -10, y: 5 })).toBeCloseTo(-0.5, 6);
	});

	it('follows the direction you are looking from', () => {
		// From the north the view runs the other way, so the same plan point sits at the far end.
		expect(tiltFactor('n', -20, 0, { x: 20, y: 5 })).toBeCloseTo(1, 6);
		expect(tiltFactor('e', 20, 0, { x: 5, y: 20 })).toBeCloseTo(1, 6);
	});

	it('does nothing when the two ends are the same place', () => {
		expect(tiltFactor('s', 5, 5, { x: 9, y: 1 })).toBe(0);
	});
});

describe('sectionVertices', () => {
	it('takes the points standing on the line', () => {
		const doc = slopingPlot();
		doc.entities.push(makeSpot({ x: 6, y: 10 }, -0.5));
		expect(sectionVertices(doc, 's').map((v) => v.u)).toContain(6);
	});

	it('leaves out a point off to the side, whose height is not the height here', () => {
		const doc = slopingPlot();
		doc.entities.push(makeSpot({ x: 6, y: 19 }, 3));
		expect(sectionVertices(doc, 's').some((v) => v.u === 6)).toBe(false);
	});

	it('puts every vertex exactly on the line it is drawn against', () => {
		const doc = slopingPlot();
		doc.entities.push(makeSpot({ x: 6, y: 10 }, -0.5));
		doc.entities.push(makeSpot({ x: 14, y: 10.4 }, -1.9));
		const field = buildField(doc);
		for (const v of sectionVertices(doc, 's')) {
			expect(v.z).toBeCloseTo(handleAt(doc, field, 's', v.u).z, 1);
		}
	});

	it('reads the points in order across the view', () => {
		const doc = slopingPlot();
		doc.entities.push(makeSpot({ x: 14, y: 10 }, -1.9));
		doc.entities.push(makeSpot({ x: 6, y: 10 }, -0.5));
		const us = sectionVertices(doc, 's').map((v) => v.u);
		expect(us).toEqual([...us].sort((a, b) => a - b));
	});
});

describe('the section line on a plot with no boundary yet', () => {
	/** Setting ground levels before drawing the tomtgräns is a normal way to start. */
	const started = (): Doc => {
		const doc = createDoc();
		for (let i = 0; i < 4; i++) doc.entities.push(makeSpot({ x: i * 5, y: 0 }, -i * 0.4));
		return doc;
	};

	it('holds still when something else is drawn', () => {
		const doc = started();
		const before = sectionPoint(doc, 's', 7);
		doc.entities.push(makePlant({ x: 4, y: 9 }, 'bjork', 0, 0));
		expect(sectionPoint(doc, 's', 7)).toEqual(before);
	});

	it('keeps every handle you have already placed', () => {
		const doc = started();
		const before = sectionVertices(doc, 's').length;
		doc.entities.push(makePlant({ x: 4, y: 9 }, 'bjork', 0, 0));
		expect(sectionVertices(doc, 's')).toHaveLength(before);
		expect(before).toBe(4);
	});

	it('follows the boundary once there is one', () => {
		const doc = started();
		doc.plot.boundary = [
			{ x: 0, y: -5 },
			{ x: 20, y: -5 },
			{ x: 20, y: 15 },
			{ x: 0, y: 15 }
		];
		expect(sectionPoint(doc, 's', 7).y).toBeCloseTo(5, 6);
	});
});
