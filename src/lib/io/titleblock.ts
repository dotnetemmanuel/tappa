import type { Doc } from '../core/doc/types.js';
import { lineStyle, material, type MaterialDef } from '../core/doc/materials.js';
import { formatArea, formatLength } from '../core/doc/dimension.js';
import { LINE_PX, PLAN } from '../render2d/theme.js';
import { hatch } from '../render2d/patterns.js';
import { takeoff } from './takeoff.js';

export type TitleBlockInfo = {
	name: string;
	date: string;
	scaleLabel: string;
	northOffset: number;
};

const SANS = 'Archivo, system-ui, sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

/** Distance from the sheet edge to the drawing border, in CSS pixels. */
export const SHEET_INSET = 16;
/** Height of the title block strip that sits inside the bottom border. */
export const TITLE_BLOCK_H = 74;

/** A CSS pixel is 1/96 inch, which is what turns a paper ratio into a pixel density. */
const PX_PER_MM = 96 / 25.4;
const RATIOS = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000] as const;

export function pxPerMetreForRatio(ratio: number): number {
	return (1000 / Math.max(1, ratio)) * PX_PER_MM;
}

/** Round up the 1, 2, 5 ladder, for a plot too large for any listed drawing scale. */
function niceRatio(raw: number): number {
	const decade = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
	for (const step of [1, 2, 5, 10]) {
		if (decade * step >= raw) return decade * step;
	}
	return decade * 10;
}

/** The nearest sensible drawing scale, e.g. 1:100, and the pixels per metre that gives. */
export function fitScale(
	worldW: number,
	worldH: number,
	pxW: number,
	pxH: number
): { ratio: number; pxPerMetre: number; label: string } {
	const w = Math.max(worldW, 0.001);
	const h = Math.max(worldH, 0.001);
	const ideal = Math.min(pxW / w, pxH / h);
	const raw = ideal > 0 ? (1000 * PX_PER_MM) / ideal : RATIOS[RATIOS.length - 1];
	const ratio = RATIOS.find((r) => r >= raw) ?? niceRatio(raw);
	return { ratio, pxPerMetre: pxPerMetreForRatio(ratio), label: `1:${ratio}` };
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
}

function fieldLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
	ctx.font = `600 9px ${SANS}`;
	ctx.fillStyle = PLAN.inkFaint;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'alphabetic';
	ctx.fillText(text.toUpperCase(), x, y);
}

/** A proper drawing border and title block along the bottom edge. */
export function drawTitleBlock(
	ctx: CanvasRenderingContext2D,
	w: number,
	h: number,
	info: TitleBlockInfo
): void {
	const x = SHEET_INSET;
	const y = SHEET_INSET;
	const iw = w - SHEET_INSET * 2;
	const ih = h - SHEET_INSET * 2;
	if (iw <= 0 || ih <= 0) return;

	ctx.save();
	ctx.strokeStyle = PLAN.ink;
	ctx.lineWidth = LINE_PX.bold;
	ctx.strokeRect(x, y, iw, ih);
	ctx.lineWidth = LINE_PX.hairline;
	ctx.strokeStyle = PLAN.inkFaint;
	ctx.strokeRect(x + 4, y + 4, iw - 8, ih - 8);

	const top = y + ih - TITLE_BLOCK_H;
	ctx.fillStyle = PLAN.paper;
	ctx.fillRect(x, top, iw, TITLE_BLOCK_H);
	ctx.strokeStyle = PLAN.ink;
	ctx.lineWidth = LINE_PX.normal;
	ctx.strokeRect(x, top, iw, TITLE_BLOCK_H);

	const widths = [Math.max(120, iw - 400), 150, 140, 110];
	const total = widths.reduce((s, v) => s + v, 0);
	const scaled = widths.map((v) => (v / total) * iw);
	const pad = 12;
	let cx = x;
	const cells: { x: number; w: number }[] = [];
	for (const cw of scaled) {
		cells.push({ x: cx, w: cw });
		cx += cw;
	}
	ctx.lineWidth = LINE_PX.thin;
	for (let i = 1; i < cells.length; i++)
		line(ctx, cells[i].x, top, cells[i].x, top + TITLE_BLOCK_H);

	const labelY = top + 20;
	const valueY = top + 50;

	fieldLabel(ctx, 'Projekt', cells[0].x + pad, labelY);
	ctx.font = `600 21px ${SANS}`;
	ctx.fillStyle = PLAN.ink;
	ctx.textAlign = 'left';
	ctx.fillText(info.name, cells[0].x + pad, valueY, cells[0].w - pad * 2);

	const mono = (i: number, label: string, value: string) => {
		fieldLabel(ctx, label, cells[i].x + pad, labelY);
		ctx.font = `16px ${MONO}`;
		ctx.fillStyle = PLAN.ink;
		ctx.textAlign = 'left';
		ctx.fillText(value, cells[i].x + pad, valueY, cells[i].w - pad * 2);
	};
	mono(1, 'Datum', info.date);
	mono(2, 'Skala', info.scaleLabel);
	mono(3, 'Norr', `${info.northOffset.toFixed(0)}°`);

	drawNorthArrow(
		ctx,
		{ x: cells[3].x + cells[3].w - 30, y: top + TITLE_BLOCK_H / 2 },
		46,
		info.northOffset
	);
	ctx.restore();
}

const BAR_LENGTHS = [1, 2, 5, 10, 20, 50, 100, 200, 500] as const;
const BAR_TARGET_PX = 200;
const BAR_H = 9;

/** A scale bar with real divisions, labelled in metres. */
export function drawScaleBar(
	ctx: CanvasRenderingContext2D,
	at: { x: number; y: number },
	pxPerMetre: number
): void {
	if (!Number.isFinite(pxPerMetre) || pxPerMetre <= 0) return;
	const usable = [...BAR_LENGTHS].filter((m) => m * pxPerMetre <= BAR_TARGET_PX);
	const metres = usable.length > 0 ? usable[usable.length - 1] : BAR_LENGTHS[0];
	const width = metres * pxPerMetre;
	const divisions = 4;
	const step = width / divisions;

	ctx.save();
	ctx.strokeStyle = PLAN.ink;
	ctx.lineWidth = LINE_PX.hairline;
	for (let i = 0; i < divisions; i++) {
		ctx.fillStyle = i % 2 === 0 ? PLAN.ink : PLAN.paper;
		ctx.fillRect(at.x + step * i, at.y, step, BAR_H);
	}
	ctx.strokeRect(at.x, at.y, width, BAR_H);

	ctx.font = `11px ${MONO}`;
	ctx.fillStyle = PLAN.ink;
	ctx.textBaseline = 'top';
	for (const i of [0, divisions / 2, divisions]) {
		ctx.textAlign = i === 0 ? 'left' : i === divisions ? 'right' : 'center';
		const tick = (metres / divisions) * i;
		ctx.fillText(
			(Number.isInteger(tick) ? String(tick) : tick.toFixed(1)).replace('.', ','),
			at.x + step * i,
			at.y + BAR_H + 5
		);
	}
	ctx.textAlign = 'left';
	ctx.fillText('m', at.x + width + 8, at.y + BAR_H + 5);
	ctx.restore();
}

/** North arrow, rotated by the document's north offset. */
export function drawNorthArrow(
	ctx: CanvasRenderingContext2D,
	at: { x: number; y: number },
	size: number,
	northOffset: number
): void {
	const r = size / 2;
	ctx.save();
	ctx.translate(at.x, at.y);
	// World rotates counter-clockwise while screen y points down, so the sign flips here.
	ctx.rotate((-northOffset * Math.PI) / 180);

	ctx.strokeStyle = PLAN.inkFaint;
	ctx.lineWidth = LINE_PX.hairline;
	ctx.beginPath();
	ctx.arc(0, 0, r, 0, Math.PI * 2);
	ctx.stroke();

	const tip = -r * 0.78;
	const tail = r * 0.66;
	const half = r * 0.3;
	ctx.fillStyle = PLAN.ink;
	ctx.beginPath();
	ctx.moveTo(0, tip);
	ctx.lineTo(half, tail);
	ctx.lineTo(0, tail * 0.45);
	ctx.closePath();
	ctx.fill();
	ctx.beginPath();
	ctx.moveTo(0, tip);
	ctx.lineTo(-half, tail);
	ctx.lineTo(0, tail * 0.45);
	ctx.closePath();
	ctx.strokeStyle = PLAN.ink;
	ctx.stroke();

	ctx.font = `600 ${Math.round(size * 0.3)}px ${SANS}`;
	ctx.fillStyle = PLAN.ink;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'bottom';
	ctx.fillText('N', 0, tip - 2);
	ctx.restore();
}

const LEGEND_W = 236;
const LEGEND_ROW_H = 21;
const LEGEND_PAD = 12;
const SWATCH_W = 28;
const SWATCH_H = 14;
/** Pixels per metre the swatch hatch is drawn at, chosen so a motif reads at this size. */
const SWATCH_SCALE = 60;

function drawSwatch(ctx: CanvasRenderingContext2D, x: number, y: number, def: MaterialDef): void {
	ctx.save();
	ctx.fillStyle = def.fill;
	ctx.fillRect(x, y, SWATCH_W, SWATCH_H);
	const pattern = hatch(ctx, def.pattern, def.stroke, SWATCH_SCALE, 1);
	if (pattern) {
		// The hatch tiles from the canvas origin, so the swatch corner becomes the origin.
		ctx.translate(x, y);
		ctx.fillStyle = pattern;
		ctx.fillRect(0, 0, SWATCH_W, SWATCH_H);
		ctx.translate(-x, -y);
	}
	ctx.strokeStyle = def.stroke;
	ctx.lineWidth = LINE_PX.hairline;
	ctx.strokeRect(x + 0.5, y + 0.5, SWATCH_W - 1, SWATCH_H - 1);
	ctx.restore();
}

/** Legend of every material and line style actually used, with its swatch. */
export function drawLegend(
	ctx: CanvasRenderingContext2D,
	at: { x: number; y: number },
	doc: Doc
): void {
	const t = takeoff(doc);
	const rows = [
		...t.materials.map((m) => ({
			mat: material(m.material),
			style: null,
			quantity: formatArea(m.areaM2),
			label: m.sv
		})),
		...t.edging.map((e) => ({
			mat: null,
			style: lineStyle(e.style),
			quantity: formatLength(e.lengthM),
			label: e.sv
		}))
	];
	if (rows.length === 0) return;

	const headH = 26;
	const h = headH + rows.length * LEGEND_ROW_H + LEGEND_PAD;
	ctx.save();
	ctx.fillStyle = PLAN.paper;
	ctx.globalAlpha = 0.94;
	ctx.fillRect(at.x, at.y, LEGEND_W, h);
	ctx.globalAlpha = 1;
	ctx.strokeStyle = PLAN.ink;
	ctx.lineWidth = LINE_PX.thin;
	ctx.strokeRect(at.x, at.y, LEGEND_W, h);

	ctx.font = `600 11px ${SANS}`;
	ctx.fillStyle = PLAN.ink;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'middle';
	ctx.fillText('TECKENFÖRKLARING', at.x + LEGEND_PAD, at.y + headH / 2);
	ctx.strokeStyle = PLAN.inkFaint;
	ctx.lineWidth = LINE_PX.hairline;
	line(ctx, at.x, at.y + headH, at.x + LEGEND_W, at.y + headH);

	let y = at.y + headH + 4;
	for (const row of rows) {
		const mid = y + SWATCH_H / 2;
		if (row.mat) {
			drawSwatch(ctx, at.x + LEGEND_PAD, y, row.mat);
		} else if (row.style) {
			ctx.strokeStyle = row.style.colour;
			ctx.lineWidth = 3;
			ctx.lineCap = 'round';
			line(ctx, at.x + LEGEND_PAD + 2, mid, at.x + LEGEND_PAD + SWATCH_W - 2, mid);
			ctx.lineCap = 'butt';
		}
		ctx.font = `12px ${SANS}`;
		ctx.fillStyle = PLAN.ink;
		ctx.textAlign = 'left';
		ctx.fillText(row.label, at.x + LEGEND_PAD + SWATCH_W + 10, mid, 110);
		ctx.font = `12px ${MONO}`;
		ctx.fillStyle = PLAN.dim;
		ctx.textAlign = 'right';
		ctx.fillText(row.quantity, at.x + LEGEND_W - LEGEND_PAD, mid);
		y += LEGEND_ROW_H;
	}
	ctx.restore();
}
