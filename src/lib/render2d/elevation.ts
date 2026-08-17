import { buildRoof } from '../core/building/roof.js';
import { wallParts, wallQuad } from '../core/building/wallgraph.js';
import { lineStyle } from '../core/doc/materials.js';
import type {
	Doc,
	Entity,
	EntityId,
	LineEntity,
	PlantEntity,
	PropEntity
} from '../core/doc/types.js';
import { layerOf } from '../core/doc/doc.js';
import type { Vec2 } from '../core/geom/vec2.js';
import { speciesOr } from '../core/plants/catalog.js';
import { sizeAt } from '../core/plants/growth.js';
import { formForProp } from '../core/props/builders.js';
import { heightAt, type HeightField } from '../core/terrain/field.js';
import { profileAlong } from '../core/terrain/query.js';
import type { GroundTarget } from '../core/terrain/edit.js';
import {
	AXES,
	elevationBounds,
	groundProfile,
	handleAt,
	sectionProfile,
	sectionVertices,
	slopeHandles,
	type Axis,
	type Facing,
	type SlopeHandle
} from '../core/terrain/section.js';
import { PLAN, LINE_PX } from './theme.js';
import { toScreen, toWorld, visibleRect, type View } from './view.js';

export type ElevationOptions = {
	years: number;
	month: number;
	/** A point on the ground line being dragged or hovered, drawn like the end handles. */
	grab?: SlopeHandle | null;
	/** Where a click would drop a new vertex, drawn as a ghost while the pointer is on the line. */
	ghost?: { u: number; z: number } | null;
	/** The vertex under the pointer, drawn a little larger. */
	hot?: EntityId | null;
};

type Shape = { far: number; paint: (ctx: CanvasRenderingContext2D) => void };

/**
 * The plot seen from one side: the ground profile with the earth under it, everything
 * standing on the plot as a flat silhouette, and the buried part of a building drawn
 * dashed through the earth rather than hidden, which is the point of the view.
 */
export function paintElevation(
	ctx: CanvasRenderingContext2D,
	doc: Doc,
	field: HeightField | null,
	facing: Facing,
	view: View,
	o: ElevationOptions
): void {
	bindView(ctx, view);
	const ax = AXES[facing];
	const r = visibleRect(view);
	const bounds = elevationBounds(doc, field, facing);
	const uMin = Math.min(bounds.min.x, r.min.x);
	const uMax = Math.max(bounds.max.x, r.max.x);

	const profile = groundProfile(doc, field, facing, uMin, uMax);
	const earth = new Path2D();
	const sky = new Path2D();
	const bottom = r.min.y - 50;
	const top = r.max.y + 50;
	const first = toScreen(view, { x: profile[0].u, y: profile[0].z });
	earth.moveTo(first.x, first.y);
	sky.moveTo(first.x, first.y);
	for (const p of profile.slice(1)) {
		const s = toScreen(view, { x: p.u, y: p.z });
		earth.lineTo(s.x, s.y);
		sky.lineTo(s.x, s.y);
	}
	const last = profile[profile.length - 1];
	const be = toScreen(view, { x: last.u, y: bottom });
	const bs = toScreen(view, { x: profile[0].u, y: bottom });
	earth.lineTo(be.x, be.y);
	earth.lineTo(bs.x, bs.y);
	earth.closePath();
	const te = toScreen(view, { x: last.u, y: top });
	const ts = toScreen(view, { x: profile[0].u, y: top });
	sky.lineTo(te.x, te.y);
	sky.lineTo(ts.x, ts.y);
	sky.closePath();

	ctx.save();
	ctx.fillStyle = PLAN.earth;
	ctx.fill(earth);

	const shapes = collect(doc, field, ax, o).sort((a, b) => b.far - a.far);

	// Below ground first, dashed through the earth, so a suterrang storey is visible but reads as buried.
	ctx.save();
	ctx.clip(earth);
	ctx.globalAlpha = 0.5;
	ctx.setLineDash([5, 4]);
	for (const s of shapes) s.paint(ctx);
	ctx.restore();

	ctx.save();
	ctx.clip(sky);
	for (const s of shapes) s.paint(ctx);
	ctx.restore();

	ctx.beginPath();
	ctx.moveTo(first.x, first.y);
	for (const p of profile.slice(1)) {
		const s = toScreen(view, { x: p.u, y: p.z });
		ctx.lineTo(s.x, s.y);
	}
	ctx.strokeStyle = PLAN.earthLine;
	ctx.lineWidth = LINE_PX.bold;
	ctx.stroke();

	paintSection(ctx, doc, field, facing, view, profile);
	paintRuler(ctx, view, bounds);
	if (o.ghost) paintGhost(ctx, view, o.ghost);
	for (const v of sectionVertices(doc, facing)) paintVertex(ctx, view, v, v.id === o.hot);
	for (const h of slopeHandles(doc, field, facing)) paintHandle(ctx, view, h);
	if (o.grab && o.grab.side !== 'along') paintHandle(ctx, view, o.grab);
	ctx.restore();
}

function collect(doc: Doc, field: HeightField | null, ax: Axis, o: ElevationOptions): Shape[] {
	const out: Shape[] = [];
	for (const e of doc.entities) {
		if (layerOf(doc, e.layer)?.visible === false) continue;
		const shape = shapeOf(doc, field, ax, e, o);
		if (shape) out.push(shape);
	}
	return out;
}

function shapeOf(
	doc: Doc,
	field: HeightField | null,
	ax: Axis,
	e: Entity,
	o: ElevationOptions
): Shape | null {
	switch (e.k) {
		case 'wall':
			return wallShape(doc, field, ax, e.id);
		case 'roof':
			return roofShape(doc, ax, e.id);
		case 'line':
			return fenceShape(field, ax, e);
		case 'plant':
			return plantShape(field, ax, e, o);
		case 'prop':
			return propShape(field, ax, e);
		default:
			return null;
	}
}

function wallShape(doc: Doc, field: HeightField | null, ax: Axis, id: string): Shape | null {
	const wall = doc.entities.find((x) => x.id === id);
	if (!wall || wall.k !== 'wall') return null;
	const quad = wallQuad(doc, wall);
	if (!quad) return null;
	const parts = wallParts(doc, wall, field);
	const us = quad.map(ax.u);
	const u0 = Math.min(...us);
	const u1 = Math.max(...us);
	const far = Math.max(...quad.map(ax.depth));
	const floor = parts.floor;
	const top = floor + wall.height;
	return {
		far,
		paint: (ctx) => {
			box(ctx, u0, u1, parts.foot, floor, PLAN.baseFill);
			box(ctx, u0, u1, floor, top, PLAN.faceFill);
		}
	};
}

function roofShape(doc: Doc, ax: Axis, id: string): Shape | null {
	const roof = doc.entities.find((x) => x.id === id);
	if (!roof || roof.k !== 'roof') return null;
	let built: ReturnType<typeof buildRoof>;
	try {
		built = buildRoof(doc, roof);
	} catch {
		return null;
	}
	if (!built || built.solid.positions.length === 0) return null;

	// The silhouette of a solid: the highest and lowest it reaches in each column across the view.
	const columns = 160;
	const pts: { u: number; y: number }[] = [];
	for (let i = 0; i < built.solid.positions.length; i += 3) {
		const p = { x: built.solid.positions[i], y: -built.solid.positions[i + 2] };
		pts.push({ u: ax.u(p), y: built.solid.positions[i + 1] });
	}
	const uMin = Math.min(...pts.map((p) => p.u));
	const uMax = Math.max(...pts.map((p) => p.u));
	const span = uMax - uMin;
	if (span < 1e-6) return null;
	const hi = new Float64Array(columns + 1).fill(-Infinity);
	const lo = new Float64Array(columns + 1).fill(Infinity);
	for (const p of pts) {
		const c = Math.round(((p.u - uMin) / span) * columns);
		if (p.y > hi[c]) hi[c] = p.y;
		if (p.y < lo[c]) lo[c] = p.y;
	}
	const far = Math.max(...built.outline.map(ax.depth));
	return {
		far,
		paint: (ctx) => {
			ctx.beginPath();
			let started = false;
			for (let c = 0; c <= columns; c++) {
				if (!Number.isFinite(hi[c])) continue;
				const u = uMin + (c / columns) * span;
				const s = screenOf(ctx, u, hi[c]);
				if (started) ctx.lineTo(s.x, s.y);
				else {
					ctx.moveTo(s.x, s.y);
					started = true;
				}
			}
			for (let c = columns; c >= 0; c--) {
				if (!Number.isFinite(lo[c])) continue;
				const u = uMin + (c / columns) * span;
				const s = screenOf(ctx, u, lo[c]);
				ctx.lineTo(s.x, s.y);
			}
			ctx.closePath();
			ctx.fillStyle = PLAN.roofFill;
			ctx.fill();
			ctx.strokeStyle = PLAN.ink;
			ctx.lineWidth = LINE_PX.thin;
			ctx.stroke();
		}
	};
}

function fenceShape(field: HeightField | null, ax: Axis, e: LineEntity): Shape | null {
	if (e.spine.length < 2 || e.height <= 0.05) return null;
	const step = field ? Math.max(field.cell, 0.25) : 1;
	const samples = profileAlong(field, e.spine, step);
	const def = lineStyle(e.style.id);
	const colour = e.style.colour ?? def.colour;
	const far = Math.max(...e.spine.map(ax.depth));
	return {
		far,
		paint: (ctx) => {
			ctx.beginPath();
			samples.forEach((s, i) => {
				const p = screenOf(ctx, ax.u(s.at), s.z + e.height);
				if (i === 0) ctx.moveTo(p.x, p.y);
				else ctx.lineTo(p.x, p.y);
			});
			for (let i = samples.length - 1; i >= 0; i--) {
				const s = samples[i];
				const p = screenOf(ctx, ax.u(s.at), s.z);
				ctx.lineTo(p.x, p.y);
			}
			ctx.closePath();
			ctx.fillStyle = colour;
			ctx.globalAlpha *= def.render === 'mesh' || def.render === 'trellis' ? 0.4 : 0.85;
			ctx.fill();
			ctx.globalAlpha = 1;
			ctx.strokeStyle = PLAN.ink;
			ctx.lineWidth = LINE_PX.hairline;
			ctx.stroke();
		}
	};
}

function plantShape(
	field: HeightField | null,
	ax: Axis,
	e: PlantEntity,
	o: ElevationOptions
): Shape | null {
	const sp = speciesOr(e.species);
	const size = sizeAt(sp, Math.max(0, o.years - (e.plantedYear ?? 0)), e.sizeJitter);
	if (size.h < 0.15) return null;
	const g = heightAt(field, e.at.x, e.at.y);
	const u = ax.u(e.at);
	const crownBase = size.h >= 3 ? size.h * 0.35 : 0;
	const colour = sp.foliage.summer;
	return {
		far: ax.depth(e.at),
		paint: (ctx) => {
			if (crownBase > 0) {
				const a = screenOf(ctx, u, g);
				const b = screenOf(ctx, u, g + crownBase + 0.2);
				ctx.beginPath();
				ctx.moveTo(a.x, a.y);
				ctx.lineTo(b.x, b.y);
				ctx.strokeStyle = '#6b5b45';
				ctx.lineWidth = Math.max(LINE_PX.normal, (size.w / 12) * scaleOf(ctx));
				ctx.stroke();
			}
			const centre = screenOf(ctx, u, g + (crownBase + size.h) / 2);
			const rx = (size.w / 2) * scaleOf(ctx);
			const ry = ((size.h - crownBase) / 2) * scaleOf(ctx);
			ctx.beginPath();
			ctx.ellipse(centre.x, centre.y, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
			ctx.fillStyle = colour;
			ctx.fill();
			ctx.strokeStyle = PLAN.ink;
			ctx.lineWidth = LINE_PX.hairline;
			ctx.stroke();
		}
	};
}

function propShape(field: HeightField | null, ax: Axis, e: PropEntity): Shape | null {
	const form = formForProp(e);
	if (form.parts.length === 0) return null;
	const scale = e.scale ?? 1;
	const g = heightAt(field, e.at.x, e.at.y);
	const u0 = ax.u(e.at);
	const boxes = form.parts.map((p) => {
		// The part sits in the prop's own frame; its footprint is enough for a silhouette.
		const half = (Math.max(p.size[0], p.size[2]) / 2) * scale;
		const mid = u0 + p.at[0] * scale;
		return {
			u0: mid - half,
			u1: mid + half,
			z0: g + (p.at[1] - p.size[1] / 2) * scale,
			z1: g + (p.at[1] + p.size[1] / 2) * scale,
			colour: p.colour
		};
	});
	return {
		far: ax.depth(e.at),
		paint: (ctx) => {
			for (const b of boxes) box(ctx, b.u0, b.u1, b.z0, b.z1, b.colour);
		}
	};
}

// ------------------------------------------------------------------ drawing

/**
 * The painter hands its own view to the shapes through the context, which keeps every
 * shape a plain function of world coordinates instead of threading the view everywhere.
 */
const viewOf = new WeakMap<CanvasRenderingContext2D, View>();

export function bindView(ctx: CanvasRenderingContext2D, view: View): void {
	viewOf.set(ctx, view);
}

function screenOf(ctx: CanvasRenderingContext2D, u: number, z: number): Vec2 {
	const view = viewOf.get(ctx);
	return view ? toScreen(view, { x: u, y: z }) : { x: u, y: -z };
}

const scaleOf = (ctx: CanvasRenderingContext2D): number => viewOf.get(ctx)?.scale ?? 1;

function box(
	ctx: CanvasRenderingContext2D,
	u0: number,
	u1: number,
	z0: number,
	z1: number,
	fill: string
): void {
	if (z1 - z0 < 1e-4) return;
	const a = screenOf(ctx, u0, z1);
	const b = screenOf(ctx, u1, z0);
	ctx.beginPath();
	ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.strokeStyle = PLAN.ink;
	ctx.lineWidth = LINE_PX.thin;
	ctx.stroke();
}

const SECTION_GAP = 0.05;

/**
 * The ground through the middle of the plot, which is the line the handles ride. It is only
 * drawn where it parts from the earth silhouette behind it, so on an even slope you see one
 * line, and where a bank at the far edge stands higher you see what you are actually moving.
 */
function paintSection(
	ctx: CanvasRenderingContext2D,
	doc: Doc,
	field: HeightField | null,
	facing: Facing,
	view: View,
	profile: readonly { u: number; z: number }[]
): void {
	if (!field || profile.length < 2) return;
	const uMin = profile[0].u;
	const uMax = profile[profile.length - 1].u;
	const line = sectionProfile(doc, field, facing, uMin, uMax);
	if (line.length < 2) return;
	const highest = (u: number): number => {
		const t = ((u - uMin) / (uMax - uMin)) * (profile.length - 1);
		const i = Math.min(profile.length - 1, Math.max(0, Math.round(t)));
		return profile[i].z;
	};

	ctx.save();
	ctx.strokeStyle = PLAN.select;
	ctx.lineWidth = LINE_PX.normal;
	let apart = false;
	let widest: { u: number; z: number; gap: number } | null = null;
	ctx.beginPath();
	for (const p of line) {
		const gap = highest(p.u) - p.z;
		const s = toScreen(view, { x: p.u, y: p.z });
		if (gap > SECTION_GAP) {
			if (!apart) ctx.moveTo(s.x, s.y);
			else ctx.lineTo(s.x, s.y);
			apart = true;
			if (!widest || gap > widest.gap) widest = { u: p.u, z: p.z, gap };
		} else {
			apart = false;
		}
	}
	ctx.stroke();

	if (widest) {
		const s = toScreen(view, { x: widest.u, y: widest.z });
		ctx.font = '11px Archivo, system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';
		const text = 'marken mitt på tomten';
		const w = ctx.measureText(text).width;
		ctx.fillStyle = PLAN.paper;
		ctx.fillRect(s.x - w / 2 - 3, s.y + 4, w + 6, 15);
		ctx.fillStyle = PLAN.contourText;
		ctx.fillText(text, s.x, s.y + 6);
	}
	ctx.restore();
}

/** Up and down chevrons, so a handle says what dragging it does before you drag it. */
function upDown(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
	const a = r * 0.55;
	ctx.beginPath();
	ctx.moveTo(x - a, y - r * 0.18);
	ctx.lineTo(x, y - r * 0.62);
	ctx.lineTo(x + a, y - r * 0.18);
	ctx.moveTo(x - a, y + r * 0.18);
	ctx.lineTo(x, y + r * 0.62);
	ctx.lineTo(x + a, y + r * 0.18);
	ctx.strokeStyle = PLAN.ink;
	ctx.lineWidth = LINE_PX.normal;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.stroke();
}

/** One height point on this section: drag it and only the ground around it moves. */
function paintVertex(
	ctx: CanvasRenderingContext2D,
	view: View,
	v: { u: number; z: number },
	hot: boolean
): void {
	const p = toScreen(view, { x: v.u, y: v.z });
	const r = hot ? VERTEX_R + 2 : VERTEX_R;
	ctx.save();
	ctx.beginPath();
	ctx.roundRect(p.x - r, p.y - r, r * 2, r * 2, 3);
	ctx.fillStyle = PLAN.paper;
	ctx.fill();
	ctx.strokeStyle = PLAN.select;
	ctx.lineWidth = LINE_PX.normal;
	ctx.stroke();
	upDown(ctx, p.x, p.y, r);
	ctx.restore();
}

/** Where a click would drop a new vertex. */
function paintGhost(
	ctx: CanvasRenderingContext2D,
	view: View,
	at: { u: number; z: number }
): void {
	const p = toScreen(view, { x: at.u, y: at.z });
	ctx.save();
	ctx.globalAlpha = 0.75;
	ctx.beginPath();
	ctx.roundRect(p.x - VERTEX_R, p.y - VERTEX_R, VERTEX_R * 2, VERTEX_R * 2, 3);
	ctx.setLineDash([3, 3]);
	ctx.strokeStyle = PLAN.select;
	ctx.lineWidth = LINE_PX.thin;
	ctx.stroke();
	ctx.setLineDash([]);
	ctx.beginPath();
	ctx.moveTo(p.x - 4, p.y);
	ctx.lineTo(p.x + 4, p.y);
	ctx.moveTo(p.x, p.y - 4);
	ctx.lineTo(p.x, p.y + 4);
	ctx.strokeStyle = PLAN.select;
	ctx.lineWidth = LINE_PX.normal;
	ctx.stroke();
	ctx.restore();
}

/** A grabbable marker with its height, at each end of the ground line. */
function paintHandle(ctx: CanvasRenderingContext2D, view: View, h: SlopeHandle): void {
	const p = toScreen(view, { x: h.u, y: h.z });
	const left = h.side !== 'right';
	ctx.save();
	ctx.beginPath();
	ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
	ctx.fillStyle = PLAN.select;
	ctx.fill();
	ctx.strokeStyle = PLAN.ink;
	ctx.lineWidth = LINE_PX.thin;
	ctx.stroke();
	upDown(ctx, p.x, p.y, HANDLE_R);

	const text = signed(h.z);
	ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
	const w = ctx.measureText(text).width;
	const x = left ? p.x + HANDLE_R + 4 : p.x - HANDLE_R - 4 - w - 8;
	ctx.fillStyle = PLAN.paper;
	ctx.fillRect(x, p.y - 9, w + 8, 18);
	ctx.strokeStyle = PLAN.select;
	ctx.strokeRect(x, p.y - 9, w + 8, 18);
	ctx.fillStyle = PLAN.ink;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, x + 4, p.y);
	ctx.restore();
}

/** What a press at a screen position means: tilt an end, take a vertex, add one, or pan. */
export type Aim = {
	target: GroundTarget;
	z: number;
	u: number;
	side: SlopeHandle['side'];
	/** The height point under the pointer, when there is one. */
	vertex?: EntityId;
};

const GRAB_PX = 10;

export function aimAt(
	doc: Doc,
	field: HeightField | null,
	facing: Facing,
	view: View,
	x: number,
	y: number
): Aim | null {
	for (const h of slopeHandles(doc, field, facing)) {
		const box = handleHitBox(view, h);
		const p = toScreen(view, { x: h.u, y: h.z });
		const onDot = Math.hypot(p.x - x, p.y - y) <= GRAB_PX + 4;
		const onNumber = x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
		if (onDot || onNumber) {
			const side = h.side === 'right' ? 'right' : 'left';
			return { target: { kind: 'tilt', side }, z: h.z, u: h.u, side };
		}
	}
	for (const v of sectionVertices(doc, facing)) {
		const p = toScreen(view, { x: v.u, y: v.z });
		if (Math.abs(p.x - x) <= VERTEX_R + 3 && Math.abs(p.y - y) <= VERTEX_R + 3) {
			return { target: { kind: 'point', u: v.u }, z: v.z, u: v.u, side: 'along', vertex: v.id };
		}
	}
	const world = toWorld(view, { x, y });
	const here = handleAt(doc, field, facing, world.x);
	const line = toScreen(view, { x: here.u, y: here.z });
	if (Math.abs(line.y - y) > GRAB_PX) return null;
	return { target: { kind: 'point', u: here.u }, z: here.z, u: here.u, side: 'along' };
}

/** Screen box of a handle's number, so the view knows what a click on it means. */
export function handleHitBox(
	view: View,
	h: SlopeHandle
): { x: number; y: number; w: number; h: number } {
	const p = toScreen(view, { x: h.u, y: h.z });
	const width = 78;
	return {
		x: h.side === 'left' ? p.x - HANDLE_R : p.x - HANDLE_R - width,
		y: p.y - 11,
		w: width + HANDLE_R * 2,
		h: 22
	};
}

export const HANDLE_R = 9;
export const VERTEX_R = 7;

/** Heights down the left edge, so you can read how deep the ground falls. */
function paintRuler(
	ctx: CanvasRenderingContext2D,
	view: View,
	bounds: { min: Vec2; max: Vec2 }
): void {
	const range = bounds.max.y - bounds.min.y;
	const step = range > 24 ? 5 : range > 10 ? 2 : range > 5 ? 1 : 0.5;
	const from = Math.ceil(bounds.min.y / step) * step;
	ctx.save();
	ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	for (let z = from; z <= bounds.max.y; z += step) {
		const p = toScreen(view, { x: 0, y: z });
		ctx.beginPath();
		ctx.moveTo(0, Math.round(p.y) + 0.5);
		ctx.lineTo(view.w, Math.round(p.y) + 0.5);
		ctx.strokeStyle = Math.abs(z) < 1e-6 ? PLAN.contourIndex : PLAN.gridMinor;
		ctx.lineWidth = LINE_PX.hairline;
		ctx.stroke();
		ctx.fillStyle = PLAN.contourText;
		ctx.fillText(signed(z), 6, p.y - 7);
	}
	ctx.restore();
}

const signed = (z: number): string => {
	const v = Math.abs(z) < 0.005 ? 0 : z;
	return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(2).replace('.', ',')}`;
};
