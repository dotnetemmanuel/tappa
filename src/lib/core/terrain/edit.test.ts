import { describe, expect, it } from 'vitest';
import { createDoc } from '../doc/doc.js';
import { makeSpot, makeWall } from '../doc/factory.js';
import type { Doc, SpotEntity } from '../doc/types.js';
import { buildField } from './field.js';
import { groundEdit } from './edit.js';
import { handleAt, slopeHandles } from './section.js';

/** A plot falling 2 m west to east, with a house standing on the high half. */
function plot(): Doc {
	const doc = createDoc();
	doc.plot.boundary = [
		{ x: 0, y: 0 },
		{ x: 20, y: 0 },
		{ x: 20, y: 20 },
		{ x: 0, y: 20 }
	];
	doc.entities.push(makeSpot({ x: 0, y: 10 }, 0));
	doc.entities.push(makeSpot({ x: 20, y: 10 }, -2));
	doc.entities.push(makeSpot({ x: 10, y: 0 }, -1));
	return doc;
}

function withHouse(doc: Doc): Doc {
	doc.nodes['n-a'] = { x: 4, y: 6 };
	doc.nodes['n-b'] = { x: 10, y: 6 };
	doc.nodes['n-c'] = { x: 10, y: 12 };
	doc.nodes['n-d'] = { x: 4, y: 12 };
	for (const [a, b] of [
		['n-a', 'n-b'],
		['n-b', 'n-c'],
		['n-c', 'n-d'],
		['n-d', 'n-a']
	]) {
		doc.entities.push({ ...makeWall(a, b, 0.25, 2.5), floor: 0.2 });
	}
	return doc;
}

/** Run an edit the way the view does: put its new points in, then apply the drag. */
function drag(doc: Doc, edit: ReturnType<typeof groundEdit>, dz: number): Doc {
	doc.entities.push(...edit.create);
	apply(doc, edit, dz);
	return doc;
}

function apply(doc: Doc, edit: ReturnType<typeof groundEdit>, dz: number): void {
	const move = edit.apply(dz);
	for (const { id, z } of move.spots) {
		const e = doc.entities.find((x) => x.id === id);
		if (e && e.k === 'spot') e.z = z;
	}
	for (const { id, floor } of move.floors) {
		const e = doc.entities.find((x) => x.id === id);
		if (e && e.k === 'wall') e.floor = floor;
	}
}

const spots = (doc: Doc): SpotEntity[] => doc.entities.filter((e): e is SpotEntity => e.k === 'spot');

describe('dragging one point on the ground line', () => {
	it('moves the ground where you grabbed it by exactly what you dragged', () => {
		const doc = plot();
		const field = buildField(doc);
		const before = handleAt(doc, field, 's', 10).z;
		drag(doc, groundEdit(doc, field, 's', { kind: 'point', u: 10 }), -1.5);
		expect(handleAt(doc, buildField(doc), 's', 10).z).toBeCloseTo(before - 1.5, 2);
	});

	it('leaves the house alone', () => {
		const doc = withHouse(plot());
		const walls = doc.entities.filter((e) => e.k === 'wall').map((e) => structuredClone(e));
		const field = buildField(doc);
		drag(doc, groundEdit(doc, field, 's', { kind: 'point', u: 7 }), -2);
		expect(doc.entities.filter((e) => e.k === 'wall')).toEqual(walls);
	});

	it('leaves the height points it did not grab exactly where they were', () => {
		const doc = plot();
		const field = buildField(doc);
		const untouched = spots(doc).map((e) => ({ id: e.id, z: e.z }));
		drag(doc, groundEdit(doc, field, 's', { kind: 'point', u: 12 }), 1);
		for (const { id, z } of untouched) {
			expect(spots(doc).find((e) => e.id === id)?.z).toBe(z);
		}
	});

	it('adds one height point the first time, and reuses it after that', () => {
		const doc = plot();
		const first = groundEdit(doc, buildField(doc), 's', { kind: 'point', u: 12 });
		expect(first.create).toHaveLength(1);
		drag(doc, first, -0.5);
		const again = groundEdit(doc, buildField(doc), 's', { kind: 'point', u: 12 });
		expect(again.create).toHaveLength(0);
		drag(doc, again, -0.5);
		expect(spots(doc)).toHaveLength(4);
		expect(handleAt(doc, buildField(doc), 's', 12).z).toBeCloseTo(first.startZ - 1, 2);
	});

	it('takes hold of a point a little to the side rather than crowding a new one next to it', () => {
		const doc = plot();
		doc.entities.push(makeSpot({ x: 12, y: 10 }, -1.2));
		const edit = groundEdit(doc, buildField(doc), 's', { kind: 'point', u: 12.8 });
		expect(edit.create).toHaveLength(0);
		expect(edit.startZ).toBeCloseTo(-1.2, 6);
	});

	it('barely disturbs the far side of the plot', () => {
		const doc = plot();
		const field = buildField(doc);
		const farBefore = handleAt(doc, field, 's', 0).z;
		drag(doc, groundEdit(doc, field, 's', { kind: 'point', u: 16 }), -2);
		expect(handleAt(doc, buildField(doc), 's', 0).z).toBeCloseTo(farBefore, 1);
	});
});

describe('dragging an end to tilt the plot', () => {
	it('moves the end you grabbed and holds the far end still', () => {
		const doc = plot();
		const field = buildField(doc);
		const [left, right] = slopeHandles(doc, field, 's');
		drag(doc, groundEdit(doc, field, 's', { kind: 'tilt', side: 'right' }), -1);
		const after = buildField(doc);
		expect(handleAt(doc, after, 's', right.u).z).toBeCloseTo(right.z - 1, 1);
		expect(handleAt(doc, after, 's', left.u).z).toBeCloseTo(left.z, 1);
	});

	it('carries the points in between along the ramp', () => {
		const doc = plot();
		const field = buildField(doc);
		const middle = handleAt(doc, field, 's', 10).z;
		drag(doc, groundEdit(doc, field, 's', { kind: 'tilt', side: 'right' }), -2);
		expect(handleAt(doc, buildField(doc), 's', 10).z).toBeCloseTo(middle - 1, 1);
	});

	it('takes the house with it, so it keeps sitting the way it sat', () => {
		const doc = withHouse(plot());
		const field = buildField(doc);
		const under = handleAt(doc, field, 's', 7).z;
		const floor = 0.2;
		drag(doc, groundEdit(doc, field, 's', { kind: 'tilt', side: 'left' }), 1.5);
		const after = buildField(doc);
		const walls = doc.entities.filter((e) => e.k === 'wall');
		// Every wall of the house keeps one floor level, and it moved with the ground beneath it.
		const levels = new Set(walls.map((w) => w.floor));
		expect(levels.size).toBe(1);
		const rose = (walls[0].floor ?? 0) - floor;
		expect(rose).toBeCloseTo(handleAt(doc, after, 's', 7).z - under, 1);
	});

	it('holds the house at one floor level even when the ramp runs across it', () => {
		const doc = withHouse(plot());
		drag(doc, groundEdit(doc, buildField(doc), 's', { kind: 'tilt', side: 'right' }), -2);
		const floors = doc.entities.filter((e) => e.k === 'wall').map((w) => w.floor);
		expect(new Set(floors).size).toBe(1);
	});

	it('tilts about the other end whichever end you take hold of', () => {
		const doc = plot();
		const field = buildField(doc);
		const [left, right] = slopeHandles(doc, field, 's');
		drag(doc, groundEdit(doc, field, 's', { kind: 'tilt', side: 'left' }), 1);
		const after = buildField(doc);
		expect(handleAt(doc, after, 's', left.u).z).toBeCloseTo(left.z + 1, 1);
		expect(handleAt(doc, after, 's', right.u).z).toBeCloseTo(right.z, 1);
	});

	it('is the same tilt seen from the opposite side', () => {
		const doc = plot();
		const field = buildField(doc);
		const before = handleAt(doc, field, 'n', 0).z;
		drag(doc, groundEdit(doc, field, 's', { kind: 'tilt', side: 'right' }), -1);
		// Looking from the north, the plot has turned around but the ground has not.
		expect(handleAt(doc, buildField(doc), 'n', 0).z).toBeCloseTo(before, 1);
	});

	it('does not walk the ground away when you drag out and back', () => {
		const doc = plot();
		const field = buildField(doc);
		const before = spots(doc).map((e) => e.z);
		const edit = groundEdit(doc, field, 's', { kind: 'tilt', side: 'right' });
		doc.entities.push(...edit.create);
		for (const dz of [-0.4, -1.2, -2, -1, 0]) apply(doc, edit, dz);
		expect(spots(doc).slice(0, before.length).map((e) => e.z)).toEqual(before);
	});
});
