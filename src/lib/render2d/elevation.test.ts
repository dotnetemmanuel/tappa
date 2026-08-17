import { describe, expect, it } from 'vitest';
import { createDoc } from '../core/doc/doc.js';
import { makeSpot } from '../core/doc/factory.js';
import type { Doc } from '../core/doc/types.js';
import { buildField, type HeightField } from '../core/terrain/field.js';
import { handleAt, slopeHandles } from '../core/terrain/section.js';
import { aimAt } from './elevation.js';
import { toScreen, type View } from './view.js';

/** Falls 2 m west to east, seen from the south on a 900 by 500 canvas at 20 px per metre. */
function scene(): { doc: Doc; field: HeightField; view: View } {
	const doc = createDoc();
	doc.plot.boundary = [
		{ x: 0, y: 0 },
		{ x: 20, y: 0 },
		{ x: 20, y: 20 },
		{ x: 0, y: 20 }
	];
	doc.entities.push(makeSpot({ x: 0, y: 10 }, 0));
	doc.entities.push(makeSpot({ x: 20, y: 10 }, -2));
	doc.entities.push(makeSpot({ x: 10, y: 10 }, -1));
	const field = buildField(doc);
	if (!field) throw new Error('expected a field');
	return { doc, field, view: { centre: { x: 10, y: -1 }, scale: 20, w: 900, h: 500 } };
}

describe('aimAt', () => {
	it('takes an end handle as a tilt', () => {
		const { doc, field, view } = scene();
		for (const h of slopeHandles(doc, field, 's')) {
			const p = toScreen(view, { x: h.u, y: h.z });
			const aim = aimAt(doc, field, 's', view, p.x, p.y);
			expect(aim?.target).toEqual({ kind: 'tilt', side: h.side });
		}
	});

	it('takes a height point on the line as that one point', () => {
		const { doc, field, view } = scene();
		const spot = doc.entities.find((e) => e.k === 'spot' && e.at.x === 10);
		const p = toScreen(view, { x: 10, y: -1 });
		const aim = aimAt(doc, field, 's', view, p.x, p.y);
		expect(aim?.vertex).toBe(spot?.id);
		expect(aim?.target.kind).toBe('point');
	});

	it('takes the bare line as a new point, with no vertex under it', () => {
		const { doc, field, view } = scene();
		const here = handleAt(doc, field, 's', 15);
		const p = toScreen(view, { x: here.u, y: here.z });
		const on = aimAt(doc, field, 's', view, p.x, p.y);
		expect(on?.target).toEqual({ kind: 'point', u: here.u });
		expect(on?.vertex).toBeUndefined();
	});

	it('lets go of the line well above and well below it', () => {
		const { doc, field, view } = scene();
		const x = toScreen(view, { x: 15, y: 0 }).x;
		const onLine = aimAt(doc, field, 's', view, x, toScreen(view, { x: 15, y: -1.5 }).y);
		expect(onLine).not.toBeNull();
		const y = toScreen(view, { x: 15, y: -1.5 }).y;
		expect(aimAt(doc, field, 's', view, x, y - 60)).toBeNull();
		expect(aimAt(doc, field, 's', view, x, y + 60)).toBeNull();
	});

	it('puts the end handles ahead of the line under them', () => {
		const { doc, field, view } = scene();
		const [left] = slopeHandles(doc, field, 's');
		const p = toScreen(view, { x: left.u, y: left.z });
		expect(aimAt(doc, field, 's', view, p.x, p.y)?.target.kind).toBe('tilt');
	});

	it('still offers the flat ground of an empty plot, which is how you start a slope', () => {
		const doc = createDoc();
		const view: View = { centre: { x: 0, y: 0 }, scale: 20, w: 900, h: 500 };
		expect(aimAt(doc, null, 's', view, 450, 250)?.target.kind).toBe('point');
		expect(aimAt(doc, null, 's', view, 450, 100)).toBeNull();
	});
});
