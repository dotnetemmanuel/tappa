import { docBounds } from '../doc/doc.js';
import type { Doc, EntityId } from '../doc/types.js';
import type { Vec2 } from '../geom/vec2.js';
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
	side: 'left' | 'right';
	/** Position across the view and the ground height there. */
	u: number;
	z: number;
	/** Where in plan that end sits, for the height point it edits. */
	at: Vec2;
	spot: EntityId | null;
};

const HANDLE_REACH = 3;

export function slopeHandles(doc: Doc, field: HeightField | null, facing: Facing): SlopeHandle[] {
	const b = docBounds(doc);
	if (!Number.isFinite(b.min.x) || b.max.x < b.min.x) return [];
	const bounds = elevationBounds(doc, field, facing);
	const inset = (bounds.max.x - bounds.min.x) * 0.02;
	const acrossPlan = facing === 's' || facing === 'n';
	const depthMin = acrossPlan ? b.min.y : b.min.x;
	const depthMax = acrossPlan ? b.max.y : b.max.x;

	return (['left', 'right'] as const).map((side) => {
		const u = side === 'left' ? bounds.min.x + inset : bounds.max.x - inset;
		// The handle sits on the ground line you can see, which is the highest ground at that
		// position, so grabbing the number moves exactly the line under it.
		let at = fromView(facing, u, (depthMin + depthMax) / 2);
		let z = -Infinity;
		const steps = 40;
		for (let k = 0; k <= steps; k++) {
			const d = depthMin + ((depthMax - depthMin) * k) / steps;
			const p = fromView(facing, u, d);
			const h = heightAt(field, p.x, p.y);
			if (h > z) {
				z = h;
				at = p;
			}
		}
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
	});
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
