import { docBounds } from '../doc/doc.js';
import type { Doc, EntityId } from '../doc/types.js';
import { rectFromPoints, type Rect, type Vec2 } from '../geom/vec2.js';
import { heightAt, type HeightField } from './field.js';
import { groundUnder } from './query.js';

/** The compass point you are standing on, looking across the plot. */
export type Facing = 'n' | 'e' | 's' | 'w';

export const FACING_SV: Record<Facing, string> = {
	n: 'Från norr',
	e: 'Från öster',
	s: 'Från söder',
	w: 'Från väster'
};

export type Axis = { u: (p: Vec2) => number; depth: (p: Vec2) => number };

/** Right hand across the view, depth away from you, so a face reads the way you would stand to it. */
export const AXES: Record<Facing, Axis> = {
	s: { u: (p) => p.x, depth: (p) => p.y },
	n: { u: (p) => -p.x, depth: (p) => -p.y },
	e: { u: (p) => p.y, depth: (p) => -p.x },
	w: { u: (p) => -p.y, depth: (p) => p.x }
};

/** World extent of the drawing in view coordinates: u across, height up. */
export function elevationBounds(doc: Doc, field: HeightField | null, facing: Facing) {
	const b = docBounds(doc);
	if (!Number.isFinite(b.min.x) || b.max.x < b.min.x) {
		return { min: { x: -10, y: -2 }, max: { x: 10, y: 8 } };
	}
	const ax = AXES[facing];
	const corners = [
		{ x: b.min.x, y: b.min.y },
		{ x: b.max.x, y: b.min.y },
		{ x: b.max.x, y: b.max.y },
		{ x: b.min.x, y: b.max.y }
	];
	const us = corners.map(ax.u);
	const ground = field ? groundUnder(field, corners) : { min: 0, max: 0 };
	let top = ground.max + 3;
	for (const e of doc.entities) {
		if (e.k === 'wall') top = Math.max(top, (e.floor ?? 0) + e.height + 2);
	}
	return {
		min: { x: Math.min(...us), y: ground.min - 2 },
		max: { x: Math.max(...us), y: top }
	};
}

/**
 * The ground height at one end of the view, as something you can grab. Each handle stands
 * for a real height point: the one nearest that end, or one that gets created there the
 * first time you drag or type.
 */
export type SlopeHandle = {
	/** Which end it belongs to, or `along` for one grabbed anywhere on the line. */
	side: 'left' | 'right' | 'along';
	/** Position across the view and the ground height there. */
	u: number;
	z: number;
	/** Where in plan that end sits, for the height point it edits. */
	at: Vec2;
	spot: EntityId | null;
};

const HANDLE_REACH = 3;

/**
 * A grab point on the section line, which runs through the middle of the plot. Dragging it
 * moves the ground at that spot and nowhere else, which the silhouette behind it cannot
 * promise: the highest ground at a position can be twenty metres away at the far edge.
 */
export function handleAt(
	doc: Doc,
	field: HeightField | null,
	facing: Facing,
	u: number,
	side: SlopeHandle['side'] = 'along'
): SlopeHandle {
	const at = sectionPoint(doc, facing, u);
	const z = heightAt(field, at.x, at.y);
	let spot: EntityId | null = null;
	let best = HANDLE_REACH;
	for (const e of doc.entities) {
		if (e.k !== 'spot') continue;
		const d = Math.hypot(e.at.x - at.x, e.at.y - at.y);
		if (d < best) {
			best = d;
			spot = e.id;
		}
	}
	return { side, u, z: Number.isFinite(z) ? z : 0, at, spot };
}

/** A height point that stands on this section, as somewhere you can grab it in the view. */
export type SectionVertex = { id: EntityId; u: number; z: number; at: Vec2; offset: number };

/**
 * The height points that stand on this section. The tolerance is tight on purpose: a point
 * off to the side sits at its own height, not at the height of the line here, so drawing it
 * on the line would put a handle where the ground is not.
 */
export function sectionVertices(doc: Doc, facing: Facing): SectionVertex[] {
	const b = docBounds(doc);
	if (!Number.isFinite(b.min.x) || b.max.x < b.min.x) return [];
	const reach = 0.75;
	const depth = sectionDepth(doc, facing);
	const out: SectionVertex[] = [];
	for (const e of doc.entities) {
		if (e.k !== 'spot') continue;
		const on = fromView(facing, uOf(facing, e.at), depth);
		const offset = Math.hypot(e.at.x - on.x, e.at.y - on.y);
		if (offset > reach) continue;
		out.push({ id: e.id, u: uOf(facing, e.at), z: e.z, at: e.at, offset });
	}
	return out.sort((p, q) => p.u - q.u);
}

/** Where a plan point lands across the view. */
export const uOf = (facing: Facing, p: Vec2): number => AXES[facing].u(p);

/**
 * How much of a tilt a point takes: all of it at the end being dragged, none at the far end
 * it pivots about, and a straight ramp in between. Points outside the two ends carry on along
 * the same ramp, so the whole plot turns as one piece.
 */
export function tiltFactor(facing: Facing, grabU: number, pivotU: number, at: Vec2): number {
	const span = grabU - pivotU;
	if (Math.abs(span) < 1e-6) return 0;
	return (uOf(facing, at) - pivotU) / span;
}

/**
 * Where the section line crosses a position in the view: the middle of the plot boundary,
 * falling back to everything drawn only when there is no boundary yet. Taken from the drawing
 * as a whole it moved every time anything was drawn, which quietly stranded every handle the
 * user had already placed and left later points a few centimetres off the earlier ones.
 */
export function sectionPoint(doc: Doc, facing: Facing, u: number): Vec2 {
	return fromView(facing, u, sectionDepth(doc, facing));
}

/**
 * How far into the plot the section runs. Worked out once and passed around, because it sorts
 * the height points and the painter asks for a point on the line a couple of hundred times a frame.
 */
export function sectionDepth(doc: Doc, facing: Facing): number {
	const acrossPlan = facing === 's' || facing === 'n';
	let mid: number;
	if (doc.plot.boundary.length >= 3) {
		const b = rectFromPoints(doc.plot.boundary);
		mid = acrossPlan ? (b.min.y + b.max.y) / 2 : (b.min.x + b.max.x) / 2;
	} else {
		// No boundary yet: the height points themselves hold the line, since anything else
		// drawn would move it and strand every handle already placed.
		const depths = doc.entities
			.filter((e) => e.k === 'spot')
			.map((e) => (acrossPlan ? e.at.y : e.at.x))
			.sort((p, q) => p - q);
		mid = depths.length > 0 ? depths[Math.floor(depths.length / 2)] : 0;
	}
	// Rounded, so a boundary nudged by a centimetre does not shift the line the points sit on.
	return Number.isFinite(mid) ? Math.round(mid * 20) / 20 : 0;
}

/** The plot itself when it has a boundary, otherwise everything drawn. */
export function plotRect(doc: Doc): Rect {
	return doc.plot.boundary.length >= 3 ? rectFromPoints(doc.plot.boundary) : docBounds(doc);
}

/** The ground along the middle of the plot, which is the line the handles ride on. */
export function sectionProfile(
	doc: Doc,
	field: HeightField | null,
	facing: Facing,
	uMin: number,
	uMax: number
): Sample[] {
	const out: Sample[] = [];
	const columns = 160;
	const depth = sectionDepth(doc, facing);
	for (let i = 0; i <= columns; i++) {
		const u = uMin + ((uMax - uMin) * i) / columns;
		const p = fromView(facing, u, depth);
		out.push({ u, z: heightAt(field, p.x, p.y) });
	}
	return out;
}

/** The two ends, which carry their heights as numbers you can read without hunting. */
export function slopeHandles(doc: Doc, field: HeightField | null, facing: Facing): SlopeHandle[] {
	const b = docBounds(doc);
	if (!Number.isFinite(b.min.x) || b.max.x < b.min.x) return [];
	const bounds = elevationBounds(doc, field, facing);
	const inset = (bounds.max.x - bounds.min.x) * 0.02;
	return [
		handleAt(doc, field, facing, bounds.min.x + inset, 'left'),
		handleAt(doc, field, facing, bounds.max.x - inset, 'right')
	];
}

export type Sample = { u: number; z: number };

/** The highest ground at each position across the view, which is the silhouette of the land. */
export function groundProfile(
	doc: Doc,
	field: HeightField | null,
	facing: Facing,
	uMin: number,
	uMax: number
): Sample[] {
	const out: Sample[] = [];
	const columns = 240;
	const du = (uMax - uMin) / columns;
	if (!field) {
		return [
			{ u: uMin, z: 0 },
			{ u: uMax, z: 0 }
		];
	}
	const b = docBounds(doc);
	const depthMin = facing === 's' || facing === 'n' ? b.min.y : b.min.x;
	const depthMax = facing === 's' || facing === 'n' ? b.max.y : b.max.x;
	const steps = 60;
	const dd = (depthMax - depthMin) / steps;
	for (let i = 0; i <= columns; i++) {
		const u = uMin + i * du;
		let z = -Infinity;
		for (let k = 0; k <= steps; k++) {
			const d = depthMin + k * dd;
			const p = fromView(facing, u, d);
			const h = heightAt(field, p.x, p.y);
			if (h > z) z = h;
		}
		out.push({ u, z: Number.isFinite(z) ? z : 0 });
	}
	return out;
}

/** Back from a position across the view plus a plan depth to a plan point. */
export function fromView(facing: Facing, u: number, d: number): Vec2 {
	switch (facing) {
		case 's':
			return { x: u, y: d };
		case 'n':
			return { x: -u, y: d };
		case 'e':
			return { x: d, y: u };
		case 'w':
			return { x: d, y: -u };
	}
}
