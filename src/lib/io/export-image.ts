import { docBounds } from '../core/doc/doc.js';
import type { Doc } from '../core/doc/types.js';
import type { Rect } from '../core/geom/vec2.js';
import { buildField, type HeightField } from '../core/terrain/field.js';
import { createPainter, type Overlay } from '../render2d/painter.js';
import { PLAN } from '../render2d/theme.js';
import type { View } from '../render2d/view.js';
import {
	drawLegend,
	drawScaleBar,
	drawTitleBlock,
	fitScale,
	pxPerMetreForRatio,
	SHEET_INSET,
	TITLE_BLOCK_H
} from './titleblock.js';

export type PlanExportOptions = {
	widthPx?: number;
	heightPx?: number;
	margin?: number;
	titleBlock?: boolean;
	legend?: boolean;
	grid?: boolean;
	scaleRatio?: number;
	/** Years since planting, so an export matches what the age slider shows. */
	years?: number;
	month?: number;
};

const DEFAULT_W = 2000;
const DEFAULT_H = 1414;
/** The sheet is laid out at this width in CSS pixels, so furniture keeps its proportions at any resolution. */
const LAYOUT_W = 1200;
const SCALE_BAR_ZONE = 44;
const EMPTY_HALF_SPAN = 10;

type Box = { x: number; y: number; w: number; h: number };

function newCanvas(w: number, h: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, Math.round(w));
	canvas.height = Math.max(1, Math.round(h));
	return canvas;
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('Kunde inte skapa en PNG.'))),
			'image/png'
		);
	});
}

function planRect(doc: Doc): Rect {
	const b = docBounds(doc);
	if (!Number.isFinite(b.min.x) || b.max.x < b.min.x) {
		return {
			min: { x: -EMPTY_HALF_SPAN, y: -EMPTY_HALF_SPAN },
			max: { x: EMPTY_HALF_SPAN, y: EMPTY_HALF_SPAN }
		};
	}
	return b;
}

/** A view that frames `r` inside `box` rather than inside the whole canvas. */
function frameIn(r: Rect, box: Box, pxPerMetre: number, w: number, h: number): View {
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	const world = { x: (r.min.x + r.max.x) / 2, y: (r.min.y + r.max.y) / 2 };
	return {
		scale: pxPerMetre,
		w,
		h,
		centre: {
			x: world.x - (cx - w / 2) / pxPerMetre,
			y: world.y + (cy - h / 2) / pxPerMetre
		}
	};
}

const EXPORT_OVERLAY = (
	grid: boolean,
	years: number,
	month: number,
	field: HeightField | null = null
): Overlay => ({
	selection: new Set<string>(),
	draft: null,
	snap: null,
	hover: null,
	marquee: null,
	showGrid: grid,
	showVertices: false,
	years,
	month,
	field
});

/** Render the plan to an offscreen canvas at export resolution and return a PNG blob. */
export async function exportPlanPng(doc: Doc, o: PlanExportOptions = {}): Promise<Blob> {
	const widthPx = Math.max(64, Math.round(o.widthPx ?? DEFAULT_W));
	const heightPx = Math.max(64, Math.round(o.heightPx ?? DEFAULT_H));
	const dpr = Math.max(1, widthPx / LAYOUT_W);
	const cssW = widthPx / dpr;
	const cssH = heightPx / dpr;

	const furniture = o.titleBlock ?? true;
	const margin = o.margin ?? 48;
	const inset = furniture ? SHEET_INSET + margin : margin;
	const bottom = furniture ? inset + TITLE_BLOCK_H + SCALE_BAR_ZONE : inset;
	const content: Box = {
		x: inset,
		y: inset,
		w: Math.max(32, cssW - inset * 2),
		h: Math.max(32, cssH - inset - bottom)
	};

	const r = planRect(doc);
	const fit =
		o.scaleRatio && o.scaleRatio > 0
			? {
					ratio: o.scaleRatio,
					pxPerMetre: pxPerMetreForRatio(o.scaleRatio),
					label: `1:${o.scaleRatio}`
				}
			: fitScale(r.max.x - r.min.x, r.max.y - r.min.y, content.w, content.h);

	const canvas = newCanvas(widthPx, heightPx);
	const painter = createPainter(canvas);
	painter.resize(cssW, cssH, dpr);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Kunde inte skapa en 2D-yta för exporten.');

	// The clip has to outlive this save, because the painter restores to it and must not paint over the title block.
	ctx.save();
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = PLAN.paper;
	ctx.fillRect(0, 0, cssW, cssH);
	ctx.beginPath();
	ctx.rect(content.x, content.y, content.w, content.h);
	ctx.clip();
	painter.draw(
		doc,
		frameIn(r, content, fit.pxPerMetre, cssW, cssH),
		EXPORT_OVERLAY(o.grid ?? false, o.years ?? 0, o.month ?? 7, buildField(doc))
	);
	ctx.restore();

	ctx.save();
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	if (o.legend ?? true) drawLegend(ctx, { x: content.x + 10, y: content.y + 10 }, doc);
	if (furniture) {
		drawScaleBar(ctx, { x: content.x, y: content.y + content.h + 12 }, fit.pxPerMetre);
		drawTitleBlock(ctx, cssW, cssH, {
			name: doc.meta.name,
			date: doc.meta.modified.slice(0, 10),
			scaleLabel: fit.label,
			northOffset: doc.meta.northOffset
		});
	}
	ctx.restore();

	return toPng(canvas);
}

/** Grab whatever the 3D canvas currently shows, at a multiple of its on screen size. */
export function exportViewPng(canvas: HTMLCanvasElement, scale = 2): Promise<Blob> {
	const s = Math.max(0.1, scale);
	const w = Math.round((canvas.clientWidth || canvas.width) * s);
	const h = Math.round((canvas.clientHeight || canvas.height) * s);
	const out = newCanvas(w, h);
	const ctx = out.getContext('2d');
	if (!ctx) throw new Error('Kunde inte skapa en 2D-yta för vyexporten.');
	ctx.imageSmoothingQuality = 'high';
	// A WebGL canvas without preserveDrawingBuffer is only readable in the frame it drew.
	ctx.drawImage(canvas, 0, 0, w, h);
	return toPng(out);
}

/** Small PNG of the plan for the project browser card. */
export function exportThumbnail(doc: Doc, px = 320): Promise<Blob> {
	return exportPlanPng(doc, {
		widthPx: px,
		heightPx: Math.round(px * 0.75),
		margin: 8,
		titleBlock: false,
		legend: false,
		grid: false
	});
}

/** Hand a blob to the user as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.rel = 'noopener';
	document.body.append(a);
	a.click();
	a.remove();
	// Revoking in the same tick cancels the download in Safari and Firefox.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
