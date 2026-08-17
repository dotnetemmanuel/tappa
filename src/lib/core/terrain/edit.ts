import { wallLoops } from '../building/wallgraph.js';
import { nextId } from '../doc/ids.js';
import type { Doc, EntityId, SpotEntity } from '../doc/types.js';
import { centroid } from '../geom/polygon.js';
import type { Vec2 } from '../geom/vec2.js';
import { heightAt, type HeightField } from './field.js';
import { lowestUnder } from './query.js';
import {
	handleAt,
	plotRect,
	sectionPoint,
	sectionVertices,
	slopeHandles,
	tiltFactor,
	uOf
} from './section.js';
import type { Facing } from './section.js';

/** What a press on the ground line in the side view means. */
export type GroundTarget =
	/** Move the ground at one position, and nothing else. */
	| { kind: 'point'; u: number }
	/** Tilt the whole plot about the far end. */
	| { kind: 'tilt'; side: 'left' | 'right' };

/**
 * A ground edit, worked out once when the press lands and then replayed for every height
 * the pointer passes through. `create` is what has to exist first, `apply` is where the
 * height points end up, both as plain data so the caller owns the undo step.
 */
export type GroundEdit = {
	create: SpotEntity[];
	apply: (dz: number) => GroundMove;
	/** The height the drag starts from, for the readout and for typing a number instead. */
	startZ: number;
};

/** Where the ground goes, and any house that rides along with it. */
export type GroundMove = {
	spots: { id: EntityId; z: number }[];
	floors: { id: EntityId; floor: number }[];
};

/** How near a press has to be, in metres, to take hold of a height point already there. */
const SNAP = 1.5;

/**
 * How far either side of a drag the ground gets pinned, in metres. Without pins a plot with a
 * handful of points has nothing local about it: every point is roughly as far from the query as
 * every other, so dragging one re-tilts the whole fit. A pin either side bounds the change the
 * way moving one vertex of a polyline only bends the two spans beside it.
 */
const PIN_GAP = 5;

export function groundEdit(
	doc: Doc,
	field: HeightField | null,
	facing: Facing,
	target: GroundTarget
): GroundEdit {
	return target.kind === 'tilt'
		? tiltEdit(doc, field, facing, target.side)
		: pointEdit(doc, field, facing, target.u);
}

/** Nothing else in the document moves: one height point does, and the ground follows it. */
function pointEdit(doc: Doc, field: HeightField | null, facing: Facing, u: number): GroundEdit {
	const near = nearestVertex(doc, facing, u);
	// Pinned about the point that moves, not about wherever the pointer happened to land.
	const create = pins(doc, field, facing, near ? uOf(facing, near.at) : u);
	// Digging one spot leaves every house at the level it was given: the base storey grows instead.
	if (near) {
		const z = near.z;
		return {
			create,
			startZ: z,
			apply: (dz) => ({ spots: [{ id: near.id, z: round(z + dz) }], floors: [] })
		};
	}
	const at = sectionPoint(doc, facing, u);
	const z = round(heightAt(field, at.x, at.y));
	const spot = makeSpotAt(at, z);
	create.push(spot);
	return {
		create,
		startZ: z,
		apply: (dz) => ({ spots: [{ id: spot.id, z: round(z + dz) }], floors: [] })
	};
}

/**
 * Height points either side of a drag, at the ground as it stands, so the change stays put.
 * They are placed about the point that will actually move, and never outside the plot, where
 * they would both widen the drawing and pin ground the user never drew.
 */
function pins(doc: Doc, field: HeightField | null, facing: Facing, u: number): SpotEntity[] {
	const out: SpotEntity[] = [];
	const here = sectionVertices(doc, facing);
	const plot = plotRect(doc);
	const acrossPlan = facing === 's' || facing === 'n';
	const lo = acrossPlan ? plot.min.x : plot.min.y;
	const hi = acrossPlan ? plot.max.x : plot.max.y;
	for (const side of [-1, 1]) {
		const at = u + side * PIN_GAP;
		const p = sectionPoint(doc, facing, at);
		const across = acrossPlan ? p.x : p.y;
		if (Number.isFinite(lo) && (across < lo || across > hi)) continue;
		const has = here.some((v) => {
			const gap = (v.u - u) * side;
			return gap > 0 && gap <= PIN_GAP + 1e-6;
		});
		if (has) continue;
		out.push(makeSpotAt(p, round(heightAt(field, p.x, p.y))));
	}
	return out;
}

/**
 * Every height point rides a ramp: all of the move at the end being dragged, none at the far
 * end, straight in between. Both ends become real points first, so the pivot is something the
 * document holds rather than a number that moves as the ground does.
 */
function tiltEdit(
	doc: Doc,
	field: HeightField | null,
	facing: Facing,
	side: 'left' | 'right'
): GroundEdit {
	const ends = slopeHandles(doc, field, facing);
	const grabbed = ends.find((h) => h.side === side);
	const far = ends.find((h) => h.side !== side);
	if (!grabbed || !far) return { create: [], startZ: 0, apply: () => ({ spots: [], floors: [] }) };

	const create: SpotEntity[] = [];
	// On a plot only a few metres across both ends would snap to the same point and the tilt
	// would pivot on itself, so the second anchor never reuses the first.
	const anchor = (u: number, taken?: EntityId): { id: EntityId; z: number; at: Vec2 } => {
		const near = nearestVertex(doc, facing, u);
		if (near && near.id !== taken) return { id: near.id, z: near.z, at: near.at };
		const at = sectionPoint(doc, facing, u);
		const z = round(heightAt(field, at.x, at.y));
		const spot = makeSpotAt(at, z);
		create.push(spot);
		return { id: spot.id, z, at };
	};
	const grabAnchor = anchor(grabbed.u);
	const farAnchor = anchor(far.u, grabAnchor.id);
	const grabU = uOf(facing, grabAnchor.at);
	const pivotU = uOf(facing, farAnchor.at);
	// The ramp is driven from the anchor, which may sit short of the handle you took hold of.
	// Without this the ground under the pointer runs away from it, at double speed on a small plot.
	const reach = grabbed.u - pivotU;
	const lever = Math.abs(reach) > 1e-6 ? (grabU - pivotU) / reach : 1;

	const riding = [
		...doc.entities.filter((e): e is SpotEntity => e.k === 'spot'),
		...create
	].map((e) => ({ id: e.id, z: e.z, t: tiltFactor(facing, grabU, pivotU, e.at) }));

	// Tilting turns the whole plot, so a house turns with it and keeps sitting the way it sat.
	const houses = houseRamps(doc, field, facing, grabU, pivotU);

	return {
		create,
		// The height on the handle, not the anchor's, so typing a number sets what it reads.
		startZ: round(grabbed.z),
		apply: (dz) => {
			const at = dz * lever;
			return {
				spots: riding.map((r) => ({ id: r.id, z: round(r.z + at * r.t) })),
				floors: houses.map((h) => ({ id: h.id, floor: round(h.floor + at * h.t) }))
			};
		}
	};
}

/**
 * Every wall, with the share of a tilt its own house takes, so one house keeps one floor.
 * The share is read at the lowest ground the house covers, because that is the corner its
 * base storey shows: anchoring there keeps the visible base the same height through a tilt.
 */
function houseRamps(
	doc: Doc,
	field: HeightField | null,
	facing: Facing,
	grabU: number,
	pivotU: number
): { id: EntityId; floor: number; t: number }[] {
	const out: { id: EntityId; floor: number; t: number }[] = [];
	const done = new Set<EntityId>();
	for (const loop of wallLoops(doc)) {
		const anchor = field ? lowestUnder(field, loop.ring).at : centroid(loop.ring);
		const t = tiltFactor(facing, grabU, pivotU, anchor);
		for (const w of loop.walls) {
			if (done.has(w.id)) continue;
			done.add(w.id);
			out.push({ id: w.id, floor: w.floor ?? 0, t });
		}
	}
	for (const e of doc.entities) {
		if (e.k !== 'wall' || done.has(e.id)) continue;
		const a = doc.nodes[e.a];
		const b = doc.nodes[e.b];
		if (!a || !b) continue;
		const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		out.push({ id: e.id, floor: e.floor ?? 0, t: tiltFactor(facing, grabU, pivotU, mid) });
	}
	return out;
}

/** The height point close enough to a position across the view to be the one you meant. */
function nearestVertex(
	doc: Doc,
	facing: Facing,
	u: number
): { id: EntityId; z: number; at: Vec2 } | null {
	let best: { id: EntityId; z: number; at: Vec2 } | null = null;
	let bestGap = SNAP;
	for (const v of sectionVertices(doc, facing)) {
		const gap = Math.abs(v.u - u);
		if (gap < bestGap) {
			bestGap = gap;
			best = { id: v.id, z: v.z, at: v.at };
		}
	}
	return best;
}

/** Where a click on the line would drop a vertex, and how high the ground is there. */
export function ghostAt(
	doc: Doc,
	field: HeightField | null,
	facing: Facing,
	u: number
): { u: number; z: number } {
	const h = handleAt(doc, field, facing, u);
	return { u: h.u, z: h.z };
}

const round = (z: number): number => Math.round(z * 100) / 100;

function makeSpotAt(at: Vec2, z: number): SpotEntity {
	return { k: 'spot', id: nextId('spot'), layer: 'ground', at, z };
}
