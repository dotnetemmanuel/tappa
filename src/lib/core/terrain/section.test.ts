import { describe, expect, it } from 'vitest';
import { createDoc } from '../doc/doc.js';
import { makeSpot } from '../doc/factory.js';
import type { Doc } from '../doc/types.js';
import { buildField, heightAt } from './field.js';
import { elevationBounds, slopeHandles } from './section.js';

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

	it('sits on the ground it stands for, so the number matches the line', () => {
		const doc = slopingPlot();
		const field = buildField(doc);
		for (const h of slopeHandles(doc, field, 's')) {
			expect(heightAt(field, h.at.x, h.at.y)).toBeCloseTo(h.z, 6);
		}
	});

	it('takes the highest ground across the plot, not the middle of it', () => {
		const doc = slopingPlot();
		// A ridge along the north edge: the line at each end has to follow the ridge.
		doc.entities.push(makeSpot({ x: 10, y: 20 }, 4));
		const field = buildField(doc);
		for (const h of slopeHandles(doc, field, 's')) {
			const middle = heightAt(field, h.at.x, 10);
			expect(h.z).toBeGreaterThanOrEqual(middle - 1e-6);
		}
	});

	it('binds to a height point that is already there', () => {
		const doc = slopingPlot();
		const field = buildField(doc);
		const [left] = slopeHandles(doc, field, 's');
		const spot = doc.entities.find((e) => e.id === left.spot);
		expect(spot?.k).toBe('spot');
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
