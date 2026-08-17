import type { AreaEntity, Doc, Entity, EntityId, SpotEntity, SurfaceMat } from '../core/doc/types.js';
import { contourLines, type ContourLine } from '../core/terrain/contour.js';
import { heightAt, type HeightField } from '../core/terrain/field.js';
import { entityRing, entityVertices, imageCorners, isEditable, layerOf } from '../core/doc/doc.js';
import { dimGeometry, formatLength, formatRing } from '../core/doc/dimension.js';
import { lineStyle, material } from '../core/doc/materials.js';
import type { Check } from '../core/analysis/checks.js';
import { planIcon } from '../core/plants/archetypes.js';
import { speciesOr } from '../core/plants/catalog.js';
import { seasonOf, sizeFactor } from '../core/plants/growth.js';
import { formForProp } from '../core/props/builders.js';
import { shadowColour, type ShadowGrid } from '../core/sun/shadow.js';
import { centroid, strokeToRing } from '../core/geom/polygon.js';
import { dist, type Vec2 } from '../core/geom/vec2.js';
import type { SnapGuide, SnapKind } from '../core/geom/snap.js';
import { HANDLE_PX, LINE_PX, PLAN } from './theme.js';
import { drawCompass } from './compass.js';
import { hatch } from './patterns.js';
import { gridStep, toScreen, visibleRect, type View } from './view.js';

export type DraftShape =
	| { d: 'ring'; pts: Vec2[]; closing: boolean; mat?: SurfaceMat }
	| { d: 'polyline'; pts: Vec2[]; width?: number; colour?: string }
	| { d: 'rect'; a: Vec2; b: Vec2 }
	| { d: 'dim'; a: Vec2; b: Vec2; offset: number }
	| { d: 'point'; at: Vec2 };

export type Overlay = {
	selection: ReadonlySet<EntityId>;
	draft?: DraftShape | null;
	snap?: { at: Vec2; kind: SnapKind; guides: readonly SnapGuide[] } | null;
	hover?: EntityId | null;
	marquee?: { a: Vec2; b: Vec2; crossing: boolean } | null;
	showGrid: boolean;
	showVertices: boolean;
	/** Years since planting, so plan symbols match the age slider. */
	years?: number;
	month?: number;
	shadow?: ShadowGrid | null;
	checks?: readonly Check[];
	/** Resolves an image asset to something drawable, once phase 7 populates it. */
	image?: (assetId: string) => CanvasImageSource | null;
	/** The baked ground, or null on a flat plot. */
	field?: HeightField | null;
	/** The north rose, on screen only: an exported sheet carries north in its title block. */
	compass?: boolean;
};

export type Painter = {
	draw(doc: Doc, view: View, overlay: Overlay): void;
	resize(w: number, h: number, dpr: number): void;
};

export function createPainter(canvas: HTMLCanvasElement): Painter {
	const surface = canvas.getContext('2d', { alpha: false });
	if (!surface) throw new Error('Kunde inte skapa en 2D-yta');
	const ctx: CanvasRenderingContext2D = surface;
	let dpr = 1;

	function resize(w: number, h: number, nextDpr: number): void {
		dpr = nextDpr;
		canvas.width = Math.max(1, Math.round(w * dpr));
		canvas.height = Math.max(1, Math.round(h * dpr));
		canvas.style.width = `${w}px`;
		canvas.style.height = `${h}px`;
	}

	function draw(doc: Doc, view: View, o: Overlay): void {
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = PLAN.paper;
		ctx.fillRect(0, 0, view.w, view.h);

		if (o.showGrid) paintGrid(ctx, view);
		if (o.field && layerOf(doc, 'ground')?.visible !== false) {
			paintContours(ctx, view, o.field, doc.meta.contour);
		}
		paintPlot(ctx, doc, view);

		for (const layer of doc.layers) {
			if (!layer.visible) continue;
			for (const e of doc.entities) {
				if (e.layer !== layer.id) continue;
				if (e.k === 'dim' || e.k === 'label') continue;
				paintEntity(ctx, doc, view, e, o, dpr);
			}
		}
		for (const e of doc.entities) {
			if (e.k !== 'dim' && e.k !== 'label') continue;
			if (!layerOf(doc, e.layer)?.visible) continue;
			paintEntity(ctx, doc, view, e, o, dpr);
		}

		if (o.shadow) paintShadow(ctx, view, o.shadow);
		if (o.checks && o.checks.length > 0) paintChecks(ctx, view, o.checks);
		if (o.compass !== false) paintCompass(ctx, view, doc.meta.northOffset);
		paintSelection(ctx, doc, view, o);
		if (o.draft) paintDraft(ctx, view, o.draft);
		if (o.marquee) paintMarquee(ctx, view, o.marquee);
		if (o.snap) paintSnap(ctx, view, o.snap);

		ctx.restore();
	}

	return { draw, resize };
}

/** Bottom right of the sheet, where a drafting rose goes, pointing where north actually is. */
function paintCompass(ctx: CanvasRenderingContext2D, view: View, northOffset: number): void {
	if (view.w < 240 || view.h < 200) return;
	drawCompass(ctx, { x: view.w - 64, y: view.h - 64 }, 28, (-northOffset * Math.PI) / 180, {
		ink: PLAN.ink,
		faint: PLAN.inkFaint,
		backing: 'rgba(236, 238, 226, 0.72)'
	});
}

function paintGrid(ctx: CanvasRenderingContext2D, view: View): void {
	const { minor, major } = gridStep(view);
	const r = visibleRect(view);
	const line = (step: number, colour: string, width: number) => {
		ctx.beginPath();
		ctx.strokeStyle = colour;
		ctx.lineWidth = width;
		const x0 = Math.floor(r.min.x / step) * step;
		for (let x = x0; x <= r.max.x; x += step) {
			const sx = Math.round(toScreen(view, { x, y: 0 }).x) + 0.5;
			ctx.moveTo(sx, 0);
			ctx.lineTo(sx, view.h);
		}
		const y0 = Math.floor(r.min.y / step) * step;
		for (let y = y0; y <= r.max.y; y += step) {
			const sy = Math.round(toScreen(view, { x: 0, y }).y) + 0.5;
			ctx.moveTo(0, sy);
			ctx.lineTo(view.w, sy);
		}
		ctx.stroke();
	};
	line(minor, PLAN.gridMinor, LINE_PX.hairline);
	line(major, PLAN.gridMajor, LINE_PX.hairline);

	const origin = toScreen(view, { x: 0, y: 0 });
	ctx.strokeStyle = PLAN.gridMajor;
	ctx.lineWidth = LINE_PX.thin;
	ctx.beginPath();
	ctx.moveTo(Math.round(origin.x) + 0.5, 0);
	ctx.lineTo(Math.round(origin.x) + 0.5, view.h);
	ctx.moveTo(0, Math.round(origin.y) + 0.5);
	ctx.lineTo(view.w, Math.round(origin.y) + 0.5);
	ctx.stroke();
}

type ContourCache = { interval: number; lines: ContourLine[] };
const contourCache = new WeakMap<HeightField, ContourCache>();

/** Tracing the whole field every frame is far too slow, and the field only changes on an edit. */
function cachedContours(f: HeightField, interval: number): ContourLine[] {
	const hit = contourCache.get(f);
	if (hit && hit.interval === interval) return hit.lines;
	const lines = contourLines(f, interval);
	contourCache.set(f, { interval, lines });
	return lines;
}

function paintContours(
	ctx: CanvasRenderingContext2D,
	view: View,
	f: HeightField,
	interval: number
): void {
	const step = interval > 0 ? interval : 0.25;
	const lines = cachedContours(f, step);
	if (lines.length === 0) return;
	const r = visibleRect(view);

	ctx.save();
	paintSlopeShade(ctx, view, f, r);
	ctx.lineJoin = 'round';
	for (const index of [false, true]) {
		ctx.beginPath();
		ctx.strokeStyle = index ? PLAN.contourIndex : PLAN.contour;
		ctx.lineWidth = index ? LINE_PX.normal : LINE_PX.thin;
		for (const l of lines) {
			if (isIndexLine(l.z, step) !== index) continue;
			if (!crossesView(l.pts, r)) continue;
			tracePoints(ctx, view, l.pts, false);
		}
		ctx.stroke();
	}
	paintDownhillTicks(ctx, view, f, lines, step, r);

	ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
	ctx.fillStyle = PLAN.contourText;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	for (const l of lines) {
		if (!isIndexLine(l.z, step) || l.pts.length < 3) continue;
		if (!crossesView(l.pts, r)) continue;
		labelContour(ctx, view, l);
	}
	ctx.restore();
}

const isIndexLine = (z: number, step: number): boolean => Math.round(z / step) % 5 === 0;

/** Low ground shaded a little darker, so the shape of the land reads before you read a number. */
function paintSlopeShade(
	ctx: CanvasRenderingContext2D,
	view: View,
	f: HeightField,
	r: { min: Vec2; max: Vec2 }
): void {
	let lo = Infinity;
	let hi = -Infinity;
	for (const h of f.h) {
		if (h < lo) lo = h;
		if (h > hi) hi = h;
	}
	if (!(hi - lo > 0.2)) return;
	// Never smaller than about eight pixels, or a zoomed out plot would fill the frame with fillRects.
	const step = Math.max(f.cell, 8 / view.scale);
	const px = Math.ceil(step * view.scale) + 1;
	ctx.save();
	for (let y = Math.max(f.y0, r.min.y); y <= Math.min(f.y0 + (f.ny - 1) * f.cell, r.max.y); y += step) {
		for (let x = Math.max(f.x0, r.min.x); x <= Math.min(f.x0 + (f.nx - 1) * f.cell, r.max.x); x += step) {
			const t = (heightAt(f, x + step / 2, y + step / 2) - lo) / (hi - lo);
			const p = toScreen(view, { x, y: y + step });
			ctx.globalAlpha = 0.16 * (1 - t);
			ctx.fillStyle = PLAN.slopeTint;
			ctx.fillRect(Math.floor(p.x), Math.floor(p.y), px, px);
		}
	}
	ctx.restore();
}

/** Short ticks on the downhill side of an index line, the drafting way to show which way is down. */
function paintDownhillTicks(
	ctx: CanvasRenderingContext2D,
	view: View,
	f: HeightField,
	lines: readonly ContourLine[],
	step: number,
	r: { min: Vec2; max: Vec2 }
): void {
	const len = 4;
	ctx.save();
	ctx.strokeStyle = PLAN.contourIndex;
	ctx.lineWidth = LINE_PX.hairline;
	ctx.beginPath();
	for (const l of lines) {
		if (!isIndexLine(l.z, step) || l.pts.length < 3) continue;
		if (!crossesView(l.pts, r)) continue;
		const every = Math.max(2, Math.round(l.pts.length / 12));
		for (let i = every; i < l.pts.length - 1; i += every) {
			const a = toScreen(view, l.pts[i - 1]);
			const b = toScreen(view, l.pts[i + 1]);
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const d = Math.hypot(dx, dy);
			if (d < 1) continue;
			const p = toScreen(view, l.pts[i]);
			// Downhill is whichever side of the line reads lower on the field.
			const nx = -dy / d;
			const ny = dx / d;
			const probe = { x: l.pts[i].x + (nx / view.scale) * 6, y: l.pts[i].y - (ny / view.scale) * 6 };
			const sign = heightAt(f, probe.x, probe.y) < l.z ? 1 : -1;
			ctx.moveTo(p.x, p.y);
			ctx.lineTo(p.x + nx * len * sign, p.y + ny * len * sign);
		}
	}
	ctx.stroke();
	ctx.restore();
}


function crossesView(pts: readonly Vec2[], r: { min: Vec2; max: Vec2 }): boolean {
	for (const p of pts) {
		if (p.x >= r.min.x && p.x <= r.max.x && p.y >= r.min.y && p.y <= r.max.y) return true;
	}
	return false;
}

/** One height on the middle of a line, laid along it, with the line cleared behind the text. */
function labelContour(ctx: CanvasRenderingContext2D, view: View, l: ContourLine): void {
	const i = Math.floor(l.pts.length / 2);
	const a = toScreen(view, l.pts[i - 1]);
	const b = toScreen(view, l.pts[i]);
	if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) return;
	const text = formatHeight(l.z);
	const w = ctx.measureText(text).width;
	let ang = Math.atan2(b.y - a.y, b.x - a.x);
	if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;

	ctx.save();
	ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
	ctx.rotate(ang);
	ctx.fillStyle = PLAN.paper;
	ctx.fillRect(-w / 2 - 2, -6, w + 4, 12);
	ctx.fillStyle = PLAN.contourText;
	ctx.fillText(text, 0, 0);
	ctx.restore();
}

/** Always signed, so a height never reads as a length. */
export function formatHeight(z: number): string {
	const v = Math.abs(z) < 0.005 ? 0 : z;
	return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(2).replace('.', ',')}`;
}

function paintSpot(ctx: CanvasRenderingContext2D, view: View, e: SpotEntity): void {
	const p = toScreen(view, e.at);
	const arm = 4.5;
	ctx.save();
	ctx.strokeStyle = PLAN.ink;
	ctx.lineWidth = LINE_PX.thin;
	ctx.beginPath();
	ctx.moveTo(p.x - arm, p.y - arm);
	ctx.lineTo(p.x + arm, p.y + arm);
	ctx.moveTo(p.x + arm, p.y - arm);
	ctx.lineTo(p.x - arm, p.y + arm);
	ctx.stroke();
	ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
	ctx.fillStyle = PLAN.ink;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.fillText(formatHeight(e.z), p.x + arm + 3, p.y);
	ctx.restore();
}

/** The level a levelled area holds, and a tick face on a ring that is a retaining wall. */
function paintGrade(ctx: CanvasRenderingContext2D, view: View, e: AreaEntity): void {
	if (!e.grade || e.ring.length < 3) return;
	ctx.save();
	if (e.grade.edge === 'wall') {
		ctx.beginPath();
		tracePoints(ctx, view, e.ring, true);
		ctx.strokeStyle = PLAN.ink;
		ctx.lineWidth = LINE_PX.bold;
		ctx.stroke();
	}
	const c = centroid(e.ring);
	const p = toScreen(view, c);
	ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
	ctx.fillStyle = PLAN.ink;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(formatHeight(e.grade.level), p.x, p.y);
	ctx.restore();
}

function tracePoints(
	ctx: CanvasRenderingContext2D,
	view: View,
	pts: readonly Vec2[],
	close: boolean,
	origin: Vec2 = { x: 0, y: 0 }
): void {
	if (pts.length === 0) return;
	const first = toScreen(view, pts[0]);
	ctx.moveTo(first.x - origin.x, first.y - origin.y);
	for (let i = 1; i < pts.length; i++) {
		const p = toScreen(view, pts[i]);
		ctx.lineTo(p.x - origin.x, p.y - origin.y);
	}
	if (close) ctx.closePath();
}

function paintPlot(ctx: CanvasRenderingContext2D, doc: Doc, view: View): void {
	const ring = doc.plot.boundary;
	if (ring.length < 2) return;
	ctx.save();
	ctx.beginPath();
	tracePoints(ctx, view, ring, true);
	ctx.strokeStyle = PLAN.plot;
	ctx.lineWidth = LINE_PX.bold;
	ctx.setLineDash([14, 5, 3, 5]);
	ctx.stroke();
	ctx.restore();
}

function fillRing(
	ctx: CanvasRenderingContext2D,
	doc: Doc,
	view: View,
	ring: readonly Vec2[],
	holes: readonly (readonly Vec2[])[] | undefined,
	mat: SurfaceMat,
	dpr: number
): void {
	const def = material(mat.id);
	const trace = (origin?: Vec2) => {
		ctx.beginPath();
		tracePoints(ctx, view, ring, true, origin);
		for (const h of holes ?? []) tracePoints(ctx, view, h, true, origin);
	};

	ctx.save();
	trace();
	ctx.fillStyle = mat.fill ?? def.fill;
	ctx.fill('evenodd');

	const pattern = hatch(ctx, def.pattern, def.stroke, view.scale, dpr);
	if (pattern) {
		// The hatch tiles from the canvas origin, so anchor it to the plan origin or it slides while panning.
		const origin = toScreen(view, { x: 0, y: 0 });
		ctx.save();
		ctx.translate(origin.x, origin.y);
		trace(origin);
		ctx.fillStyle = pattern;
		ctx.fill('evenodd');
		ctx.restore();
	}

	trace();
	ctx.strokeStyle = def.stroke;
	ctx.lineWidth = LINE_PX.thin;
	ctx.stroke();
	ctx.restore();
}

function paintEntity(
	ctx: CanvasRenderingContext2D,
	doc: Doc,
	view: View,
	e: Entity,
	o: Overlay,
	dpr: number
): void {
	switch (e.k) {
		case 'area':
			if (e.ring.length >= 3) fillRing(ctx, doc, view, e.ring, e.holes, e.mat, dpr);
			if (e.grade) paintGrade(ctx, view, e);
			break;
		case 'spot':
			paintSpot(ctx, view, e);
			break;
		case 'path': {
			if (e.spine.length < 2) break;
			fillRing(ctx, doc, view, strokeToRing(e.spine, e.width), undefined, e.mat, dpr);
			break;
		}
		case 'line': {
			if (e.spine.length < 2) break;
			paintRun(ctx, view, e.spine, e.thickness, lineStyle(e.style.id).colour, e.style.colour);
			break;
		}
		case 'wall': {
			const a = doc.nodes[e.a];
			const b = doc.nodes[e.b];
			if (!a || !b) break;
			fillRing(
				ctx,
				doc,
				view,
				strokeToRing([a, b], e.thickness),
				undefined,
				{ id: 'building' },
				dpr
			);
			break;
		}
		case 'image':
			paintImage(ctx, doc, view, e, o);
			break;
		case 'plant':
			paintPlant(ctx, view, e, o);
			break;
		case 'prop':
			paintProp(ctx, view, e);
			break;
		case 'label':
			paintLabel(ctx, view, e.at, e.text, e.size, e.rot ?? 0);
			break;
		case 'dim':
			paintDim(ctx, doc, view, e);
			break;
		case 'roof':
			break;
	}
}

function paintRun(
	ctx: CanvasRenderingContext2D,
	view: View,
	spine: readonly Vec2[],
	thickness: number,
	base: string,
	override: string | undefined
): void {
	ctx.save();
	ctx.beginPath();
	tracePoints(ctx, view, spine, false);
	ctx.strokeStyle = override ?? base;
	ctx.lineWidth = Math.max(LINE_PX.normal, thickness * view.scale);
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.stroke();
	ctx.restore();
}

function paintImage(
	ctx: CanvasRenderingContext2D,
	doc: Doc,
	view: View,
	e: Extract<Entity, { k: 'image' }>,
	o: Overlay
): void {
	const asset = doc.assets.find((a) => a.id === e.asset);
	const corners = imageCorners(e.transform, asset ?? { w: 1000, h: 1000 });
	const src = o.image?.(e.asset) ?? null;
	ctx.save();
	ctx.globalAlpha = e.opacity;
	if (src && asset) {
		const c = toScreen(view, e.transform.at);
		ctx.translate(c.x, c.y);
		ctx.rotate(-e.transform.rot);
		const w = asset.w * e.transform.mPerPx * view.scale;
		const h = asset.h * e.transform.mPerPx * view.scale;
		ctx.drawImage(src, -w / 2, -h / 2, w, h);
	} else {
		ctx.beginPath();
		tracePoints(ctx, view, corners, true);
		ctx.fillStyle = 'rgba(120,130,120,0.12)';
		ctx.fill();
		ctx.setLineDash([6, 4]);
		ctx.strokeStyle = PLAN.inkFaint;
		ctx.lineWidth = LINE_PX.thin;
		ctx.stroke();
	}
	ctx.restore();
}

/** The plan symbol comes from the same archetype that builds the 3D form. */
function paintPlant(
	ctx: CanvasRenderingContext2D,
	view: View,
	e: Extract<Entity, { k: 'plant' }>,
	o: Overlay
): void {
	const sp = speciesOr(e.species);
	const month = o.month ?? 7;
	const age = Math.max(0, (o.years ?? 0) - (e.plantedYear ?? 0));
	const factor = sizeFactor(sp, age) * (1 + e.sizeJitter);
	const icon = planIcon({
		species: sp,
		sizeFactor: Math.max(0.04, factor),
		season: seasonOf(month),
		month,
		seed: e.id
	});
	if (icon.outline.length < 3) return;

	const pts = icon.outline.map((p) => ({ x: e.at.x + p.x, y: e.at.y + p.y }));
	ctx.save();
	ctx.beginPath();
	tracePoints(ctx, view, pts, true);
	if (icon.bare) {
		ctx.setLineDash([4, 3]);
	} else {
		ctx.fillStyle = icon.fill;
		ctx.globalAlpha = 0.85;
		ctx.fill();
		ctx.globalAlpha = 1;
	}
	ctx.strokeStyle = icon.stroke;
	ctx.lineWidth = LINE_PX.thin;
	ctx.stroke();
	ctx.setLineDash([]);

	const c = toScreen(view, e.at);
	if (icon.trunkR > 0) {
		ctx.beginPath();
		ctx.arc(c.x, c.y, Math.max(1.2, icon.trunkR * view.scale), 0, Math.PI * 2);
		ctx.fillStyle = sp.bark;
		ctx.fill();
	}
	ctx.restore();
}

function paintProp(
	ctx: CanvasRenderingContext2D,
	view: View,
	e: Extract<Entity, { k: 'prop' }>
): void {
	const form = formForProp(e);
	if (form.outline.length < 3) return;
	const cos = Math.cos(e.rot ?? 0);
	const sin = Math.sin(e.rot ?? 0);
	const s = e.scale ?? 1;
	const pts = form.outline.map((p) => ({
		x: e.at.x + (p.x * cos - p.y * sin) * s,
		y: e.at.y + (p.x * sin + p.y * cos) * s
	}));
	ctx.save();
	ctx.beginPath();
	tracePoints(ctx, view, pts, true);
	ctx.fillStyle = form.fill;
	ctx.globalAlpha = 0.9;
	ctx.fill();
	ctx.globalAlpha = 1;
	ctx.strokeStyle = form.stroke;
	ctx.lineWidth = LINE_PX.thin;
	ctx.stroke();
	ctx.restore();
}

/** Sun hours per day, painted as translucent cells over the plan. */
function paintShadow(ctx: CanvasRenderingContext2D, view: View, g: ShadowGrid): void {
	const w = g.cell * view.scale;
	if (w < 1.5) return;
	ctx.save();
	ctx.globalAlpha = 0.5;
	for (let row = 0; row < g.rows; row++) {
		for (let col = 0; col < g.cols; col++) {
			const hours = g.hours[row * g.cols + col];
			const p = toScreen(view, {
				x: g.origin.x + col * g.cell,
				y: g.origin.y + (row + 1) * g.cell
			});
			ctx.fillStyle = shadowColour(hours, g.maxHours);
			ctx.fillRect(p.x, p.y, w + 1, w + 1);
		}
	}
	ctx.restore();
}

function paintChecks(ctx: CanvasRenderingContext2D, view: View, checks: readonly Check[]): void {
	ctx.save();
	ctx.lineWidth = LINE_PX.thin;
	ctx.setLineDash([3, 3]);
	for (const c of checks) {
		const p = toScreen(view, c.at);
		const r = Math.max(5, c.radius * view.scale);
		ctx.strokeStyle = c.kind === 'spacing' ? PLAN.warn : '#b08b2a';
		ctx.beginPath();
		ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.restore();
}

function paintLabel(
	ctx: CanvasRenderingContext2D,
	view: View,
	at: Vec2,
	text: string,
	size: number,
	rot: number
): void {
	const p = toScreen(view, at);
	ctx.save();
	ctx.translate(p.x, p.y);
	ctx.rotate(-rot);
	ctx.font = `${Math.max(10, size * view.scale)}px Archivo, system-ui, sans-serif`;
	ctx.fillStyle = PLAN.ink;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText(text, 0, 0);
	ctx.restore();
}

function paintDim(
	ctx: CanvasRenderingContext2D,
	doc: Doc,
	view: View,
	e: Extract<Entity, { k: 'dim' }>
): void {
	const g = dimGeometry(doc, e);
	if (!g) return;
	ctx.save();
	ctx.strokeStyle = PLAN.dim;
	ctx.fillStyle = PLAN.dim;
	ctx.lineWidth = LINE_PX.hairline;

	ctx.beginPath();
	tracePoints(ctx, view, g.witnessA, false);
	tracePoints(ctx, view, g.witnessB, false);
	ctx.stroke();

	const a = toScreen(view, g.lineA);
	const b = toScreen(view, g.lineB);
	ctx.beginPath();
	ctx.moveTo(a.x, a.y);
	ctx.lineTo(b.x, b.y);
	ctx.lineWidth = LINE_PX.thin;
	ctx.stroke();
	arrowHead(ctx, a, b);
	arrowHead(ctx, b, a);

	const label = e.text ?? formatLength(g.value);
	const t = toScreen(view, g.textAt);
	ctx.translate(t.x, t.y);
	ctx.rotate(-g.textRot);
	ctx.font = '12px "IBM Plex Mono", ui-monospace, monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'bottom';
	const w = ctx.measureText(label).width;
	ctx.fillStyle = PLAN.paper;
	ctx.fillRect(-w / 2 - 3, -13, w + 6, 14);
	ctx.fillStyle = PLAN.dim;
	ctx.fillText(label, 0, -2);
	ctx.restore();
}

function arrowHead(ctx: CanvasRenderingContext2D, tip: Vec2, from: Vec2): void {
	const a = Math.atan2(tip.y - from.y, tip.x - from.x);
	const size = 7;
	ctx.beginPath();
	ctx.moveTo(tip.x, tip.y);
	ctx.lineTo(tip.x - Math.cos(a - 0.35) * size, tip.y - Math.sin(a - 0.35) * size);
	ctx.lineTo(tip.x - Math.cos(a + 0.35) * size, tip.y - Math.sin(a + 0.35) * size);
	ctx.closePath();
	ctx.fill();
}

function paintSelection(ctx: CanvasRenderingContext2D, doc: Doc, view: View, o: Overlay): void {
	if (o.hover && !o.selection.has(o.hover)) {
		const e = doc.entities.find((x) => x.id === o.hover);
		if (e) outline(ctx, doc, view, e, PLAN.inkFaint, LINE_PX.normal, []);
	}
	for (const id of o.selection) {
		const e = doc.entities.find((x) => x.id === id);
		if (!e) continue;
		outline(ctx, doc, view, e, PLAN.select, LINE_PX.bold, []);
		if (o.showVertices && isEditable(doc, e)) {
			for (const p of entityVertices(doc, e)) handle(ctx, toScreen(view, p));
		}
	}
}

function outline(
	ctx: CanvasRenderingContext2D,
	doc: Doc,
	view: View,
	e: Entity,
	colour: string,
	width: number,
	dash: number[]
): void {
	const ring = entityRing(doc, e);
	ctx.save();
	ctx.strokeStyle = colour;
	ctx.lineWidth = width;
	ctx.setLineDash(dash);
	ctx.lineJoin = 'round';
	ctx.beginPath();
	if (ring && ring.length >= 2) {
		tracePoints(ctx, view, ring, true);
	} else {
		const vs = entityVertices(doc, e);
		if (vs.length === 1) {
			const p = toScreen(view, vs[0]);
			ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
		} else {
			tracePoints(ctx, view, vs, false);
		}
	}
	ctx.stroke();
	ctx.restore();
}

function handle(ctx: CanvasRenderingContext2D, p: Vec2): void {
	ctx.save();
	ctx.beginPath();
	ctx.rect(
		p.x - HANDLE_PX.vertex,
		p.y - HANDLE_PX.vertex,
		HANDLE_PX.vertex * 2,
		HANDLE_PX.vertex * 2
	);
	ctx.fillStyle = PLAN.paper;
	ctx.fill();
	ctx.strokeStyle = PLAN.select;
	ctx.lineWidth = LINE_PX.thin;
	ctx.stroke();
	ctx.restore();
}

function paintDraft(ctx: CanvasRenderingContext2D, view: View, d: DraftShape): void {
	ctx.save();
	ctx.strokeStyle = PLAN.snap;
	ctx.lineWidth = LINE_PX.normal;
	ctx.lineJoin = 'round';
	switch (d.d) {
		case 'ring': {
			ctx.beginPath();
			tracePoints(ctx, view, d.pts, d.closing);
			ctx.fillStyle = 'rgba(200, 99, 31, 0.10)';
			if (d.pts.length > 2) ctx.fill();
			ctx.stroke();
			paintRunningReadout(ctx, view, d.pts, true);
			break;
		}
		case 'polyline': {
			ctx.beginPath();
			tracePoints(ctx, view, d.pts, false);
			if (d.width) ctx.lineWidth = Math.max(LINE_PX.normal, d.width * view.scale);
			if (d.colour) ctx.strokeStyle = d.colour;
			ctx.lineCap = 'round';
			ctx.stroke();
			paintRunningReadout(ctx, view, d.pts, false);
			break;
		}
		case 'rect': {
			const pts = [d.a, { x: d.b.x, y: d.a.y }, d.b, { x: d.a.x, y: d.b.y }];
			ctx.beginPath();
			tracePoints(ctx, view, pts, true);
			ctx.fillStyle = 'rgba(200, 99, 31, 0.10)';
			ctx.fill();
			ctx.stroke();
			paintRunningReadout(ctx, view, [...pts, d.a], true);
			break;
		}
		case 'dim': {
			const a = toScreen(view, d.a);
			const b = toScreen(view, d.b);
			ctx.setLineDash([5, 4]);
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();
			break;
		}
		case 'point': {
			const p = toScreen(view, d.at);
			ctx.beginPath();
			ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
			ctx.stroke();
			break;
		}
	}
	for (const p of shapePoints(d)) handle(ctx, toScreen(view, p));
	ctx.restore();
}

function shapePoints(d: DraftShape): Vec2[] {
	switch (d.d) {
		case 'ring':
		case 'polyline':
			return d.pts;
		case 'rect':
			return [d.a, d.b];
		case 'dim':
			return [d.a, d.b];
		case 'point':
			return [d.at];
	}
}

/** Segment lengths while drawing, plus running area for a ring. */
function paintRunningReadout(
	ctx: CanvasRenderingContext2D,
	view: View,
	pts: readonly Vec2[],
	closed: boolean
): void {
	if (pts.length < 2) return;
	ctx.save();
	ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
	ctx.fillStyle = PLAN.snap;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const n = closed ? pts.length : pts.length - 1;
	for (let i = 0; i < n; i++) {
		const a = pts[i];
		const b = pts[(i + 1) % pts.length];
		const d = dist(a, b);
		if (d * view.scale < 34) continue;
		const mid = toScreen(view, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
		const label = formatLength(d);
		const w = ctx.measureText(label).width;
		ctx.fillStyle = PLAN.paper;
		ctx.fillRect(mid.x - w / 2 - 3, mid.y - 8, w + 6, 15);
		ctx.fillStyle = PLAN.snap;
		ctx.fillText(label, mid.x, mid.y);
	}
	if (closed && pts.length >= 3) {
		const c = toScreen(view, centroid(pts));
		const r = formatRing(pts);
		const label = `${r.area}  ·  ${r.perimeter}`;
		const w = ctx.measureText(label).width;
		ctx.fillStyle = PLAN.paper;
		ctx.fillRect(c.x - w / 2 - 4, c.y - 9, w + 8, 17);
		ctx.fillStyle = PLAN.ink;
		ctx.fillText(label, c.x, c.y);
	}
	ctx.restore();
}

function paintMarquee(
	ctx: CanvasRenderingContext2D,
	view: View,
	m: { a: Vec2; b: Vec2; crossing: boolean }
): void {
	const a = toScreen(view, m.a);
	const b = toScreen(view, m.b);
	ctx.save();
	ctx.beginPath();
	ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
	ctx.fillStyle = PLAN.selectSoft;
	ctx.fill();
	ctx.strokeStyle = PLAN.select;
	ctx.lineWidth = LINE_PX.hairline;
	if (m.crossing) ctx.setLineDash([5, 4]);
	ctx.stroke();
	ctx.restore();
}

function paintSnap(
	ctx: CanvasRenderingContext2D,
	view: View,
	s: { at: Vec2; kind: SnapKind; guides: readonly SnapGuide[] }
): void {
	if (s.kind === 'free') return;
	ctx.save();
	ctx.strokeStyle = PLAN.guide;
	ctx.lineWidth = LINE_PX.hairline;
	ctx.setLineDash([4, 4]);
	for (const g of s.guides) {
		ctx.beginPath();
		if (g.g === 'line') {
			const a = toScreen(view, g.a);
			const b = toScreen(view, g.b);
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
		} else if (g.g === 'ring') {
			const c = toScreen(view, g.at);
			ctx.arc(c.x, c.y, Math.max(4, g.r * view.scale), 0, Math.PI * 2);
		} else {
			const c = toScreen(view, g.at);
			ctx.moveTo(c.x - 5, c.y);
			ctx.lineTo(c.x + 5, c.y);
		}
		ctx.stroke();
	}

	const p = toScreen(view, s.at);
	ctx.setLineDash([]);
	ctx.strokeStyle = PLAN.snap;
	ctx.lineWidth = LINE_PX.normal;
	ctx.beginPath();
	const r = HANDLE_PX.snap;
	if (s.kind === 'grid') {
		ctx.moveTo(p.x - r, p.y);
		ctx.lineTo(p.x + r, p.y);
		ctx.moveTo(p.x, p.y - r);
		ctx.lineTo(p.x, p.y + r);
	} else if (s.kind === 'midpoint') {
		ctx.moveTo(p.x - r, p.y + r * 0.7);
		ctx.lineTo(p.x, p.y - r * 0.7);
		ctx.lineTo(p.x + r, p.y + r * 0.7);
		ctx.closePath();
	} else if (s.kind === 'perpendicular') {
		ctx.moveTo(p.x - r, p.y + r);
		ctx.lineTo(p.x - r, p.y - r);
		ctx.moveTo(p.x - r, p.y);
		ctx.lineTo(p.x + r, p.y);
	} else {
		ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
	}
	ctx.stroke();
	ctx.restore();
}
