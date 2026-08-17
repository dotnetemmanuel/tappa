import { describe, expect, it } from 'vitest';
import { createDoc } from '../doc/doc.js';
import { makeSpot } from '../doc/factory.js';
import type { Doc } from '../doc/types.js';
import { buildField, type HeightField } from '../terrain/field.js';
import { hoursAt, shadowStudy } from './shadow.js';

const WINTER = new Date(2026, 11, 21, 12, 0, 0);

function plot(): Doc {
	const doc = createDoc();
	doc.plot.boundary = [
		{ x: 0, y: 0 },
		{ x: 20, y: 0 },
		{ x: 20, y: 20 },
		{ x: 0, y: 20 }
	];
	return doc;
}

/** A bank that climbs steeply to the south, which is where the winter sun is. */
function bankToTheSouth(doc: Doc): HeightField {
	doc.entities.push(makeSpot({ x: 10, y: 14 }, 0));
	doc.entities.push(makeSpot({ x: 10, y: -6 }, 12));
	doc.entities.push(makeSpot({ x: 0, y: 14 }, 0));
	const f = buildField(doc);
	if (!f) throw new Error('expected a field');
	return f;
}

function study(doc: Doc, field: HeightField | null) {
	return shadowStudy(doc, { day: WINTER, stepMinutes: 30, cell: 1, years: 0, field });
}

describe('shadowStudy on terrain', () => {
	it('gives the same answer on flat ground as with no ground at all', () => {
		const doc = plot();
		doc.entities.push(makeSpot({ x: 5, y: 5 }, 0));
		const flat = buildField(doc);
		const withField = study(doc, flat);
		const without = study(plot(), null);
		expect(withField.hours.length).toBe(without.hours.length);
		for (let i = 0; i < withField.hours.length; i++) {
			expect(withField.hours[i]).toBeCloseTo(without.hours[i], 5);
		}
	});

	it('puts the ground behind a bank into its shade', () => {
		const doc = plot();
		const field = bankToTheSouth(doc);
		const shaded = hoursAt(study(doc, field), { x: 10, y: 15 });
		const open = hoursAt(study(plot(), null), { x: 10, y: 15 });
		expect(shaded).not.toBeNull();
		expect(open).not.toBeNull();
		expect(shaded as number).toBeLessThan(open as number);
	});

	it('leaves the land alone when it does not stand in the way', () => {
		const doc = plot();
		doc.entities.push(makeSpot({ x: 10, y: 0 }, 0));
		doc.entities.push(makeSpot({ x: 10, y: 20 }, 4));
		doc.entities.push(makeSpot({ x: 0, y: 0 }, 0));
		const field = buildField(doc);
		const onSlope = hoursAt(study(doc, field), { x: 10, y: 10 });
		const onFlat = hoursAt(study(plot(), null), { x: 10, y: 10 });
		expect(onSlope as number).toBeGreaterThanOrEqual((onFlat as number) - 1e-6);
	});
});
