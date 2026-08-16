import type { MaterialDef } from '../core/doc/materials.js';

export type PatternKind = MaterialDef['pattern'];

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Surface = { canvas: HTMLCanvasElement | OffscreenCanvas; g: Ctx };

/** Tile geometry in device pixels, resolved for one zoom level. */
type Geom = {
	/** Tile edge. */
	px: number;
	/** One motif cell. */
	cell: number;
	cells: number;
	/** Device pixels per metre the tile was actually drawn at. */
	s: number;
};

type Spec = {
	/** One repeat of the motif on the ground, in metres. */
	cellM: number;
	cells: number;
	/** Below this the motif loses its structure, so the tile stops shrinking. */
	minCells: number;
	/** CSS pixels per cell below which the hatch is mush and we draw a flat fill. */
	minCellPx: number;
	alpha: number;
	lineM?: number;
	/** Cells across the palette swatch. */
	swatchCells: number;
	draw: (g: Ctx, t: Geom, rand: () => number) => void;
};

const GRASS_TUFT_M = 0.4;
const GRASS_BLADE_M = 0.14;
const GRAVEL_STONE_M = 0.04;
const GRAVEL_DOT_M = 0.008;
const PAVING_SLAB_M = 0.4;
const DECK_BOARD_M = 0.12;
const DECK_JOINT_EVERY = 4;
const WATER_RIPPLE_M = 0.2;
const WATER_WAVE_LEN_M = 0.5;
const WATER_WAVE_AMP_M = 0.045;
const WATER_GROUP = 4;
const SOIL_DASH_M = 0.16;
const BARK_FLAKE_M = 0.09;
const STONE_COBBLE_M = 0.14;

const HATCH_LINE_M = 0.006;
const MIN_LINE_PX = 0.75;
const MAX_LINE_PX = 2.4;

/** Steps per octave of zoom, so a pan or a nudge of the wheel reuses the tile. */
const QUANT_STEPS = 4;
const TARGET_TILE_PX = 320;
const HARD_TILE_PX = 512;
const MIN_TILE_PX = 6;
const CACHE_LIMIT = 48;

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hash2(x: number, y: number, seed: number): number {
	let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0x7f4a7c15, 0xc2b2ae35) ^ seed;
	h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
	return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function seedOf(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

const wrap = (n: number, m: number): number => ((n % m) + m) % m;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Repeats a motif across the tile seam so nothing is cut in half. */
function stamp(px: number, x: number, y: number, r: number, fn: (x: number, y: number) => void) {
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			const nx = x + dx * px;
			const ny = y + dy * px;
			if (nx + r < 0 || nx - r > px || ny + r < 0 || ny - r > px) continue;
			fn(nx, ny);
		}
	}
}

function drawGrass(g: Ctx, t: Geom, rand: () => number): void {
	const blade = GRASS_BLADE_M * t.s;
	for (let j = 0; j < t.cells; j++) {
		for (let i = 0; i < t.cells; i++) {
			const tufts = rand() < 0.35 ? 2 : 1;
			for (let k = 0; k < tufts; k++) {
				const x = (i + 0.15 + rand() * 0.7) * t.cell;
				const y = (j + 0.15 + rand() * 0.7) * t.cell;
				const lean = (rand() - 0.5) * 0.8;
				const h = blade * (0.7 + rand() * 0.6);
				stamp(t.px, x, y, h, (sx, sy) => {
					g.beginPath();
					for (let b = -1; b <= 1; b++) {
						g.moveTo(sx + b * h * 0.3, sy);
						g.lineTo(sx + b * h * 0.55 + lean * h, sy - h);
					}
					g.stroke();
				});
			}
		}
	}
}

function drawGravel(g: Ctx, t: Geom, rand: () => number): void {
	const big = GRAVEL_DOT_M * t.s;
	for (let j = 0; j < t.cells; j++) {
		for (let i = 0; i < t.cells; i++) {
			const dots = rand() < 0.45 ? 2 : 1;
			for (let k = 0; k < dots; k++) {
				const x = (i + rand()) * t.cell;
				const y = (j + rand()) * t.cell;
				const r = Math.max(0.55, big * (k === 0 ? 0.8 + rand() * 0.5 : 0.4 + rand() * 0.2));
				stamp(t.px, x, y, r, (sx, sy) => {
					g.beginPath();
					g.arc(sx, sy, r, 0, Math.PI * 2);
					g.fill();
				});
			}
		}
	}
}

function drawPaving(g: Ctx, t: Geom): void {
	for (let r = 0; r <= t.cells; r++) {
		const y = r * t.cell;
		g.beginPath();
		g.moveTo(0, y);
		g.lineTo(t.px, y);
		g.stroke();
	}
	for (let r = 0; r < t.cells; r++) {
		const offset = r % 2 === 0 ? 0 : t.cell / 2;
		for (let k = 0; k <= t.cells; k++) {
			const x = offset + k * t.cell;
			g.beginPath();
			g.moveTo(x, r * t.cell);
			g.lineTo(x, (r + 1) * t.cell);
			g.stroke();
		}
	}
}

function drawDeck(g: Ctx, t: Geom, rand: () => number): void {
	for (let i = 0; i <= t.cells; i++) {
		const y = i * t.cell;
		g.beginPath();
		g.moveTo(0, y);
		g.lineTo(t.px, y);
		g.stroke();
	}
	for (let i = 0; i < t.cells; i++) {
		if (i % DECK_JOINT_EVERY !== 2) continue;
		const x = (0.15 + rand() * 0.7) * t.px;
		g.beginPath();
		g.moveTo(x, i * t.cell);
		g.lineTo(x, (i + 1) * t.cell);
		g.stroke();
	}
}

function drawWater(g: Ctx, t: Geom, rand: () => number): void {
	const waves = Math.max(1, Math.round(t.px / t.s / WATER_WAVE_LEN_M));
	const lambda = t.px / waves;
	const amp = WATER_WAVE_AMP_M * t.s;
	const steps = waves * 12;
	for (let i = 0; i < t.cells; i++) {
		if (i % WATER_GROUP === WATER_GROUP - 1) continue;
		const phase = rand() * Math.PI * 2;
		const y0 = (i + 0.5) * t.cell;
		g.beginPath();
		for (let k = 0; k <= steps; k++) {
			const x = (k / steps) * t.px;
			const y = y0 + Math.sin((x / lambda) * Math.PI * 2 + phase) * amp;
			if (k === 0) g.moveTo(x, y);
			else g.lineTo(x, y);
		}
		g.stroke();
	}
}

function drawSoil(g: Ctx, t: Geom, rand: () => number): void {
	for (let j = 0; j < t.cells; j++) {
		for (let i = 0; i < t.cells; i++) {
			const x = (i + 0.1 + rand() * 0.8) * t.cell;
			const y = (j + 0.1 + rand() * 0.8) * t.cell;
			const len = t.cell * (0.3 + rand() * 0.3);
			const a = rand() * Math.PI;
			const dx = (Math.cos(a) * len) / 2;
			const dy = (Math.sin(a) * len) / 2;
			stamp(t.px, x, y, len, (sx, sy) => {
				g.beginPath();
				g.moveTo(sx - dx, sy - dy);
				g.lineTo(sx + dx, sy + dy);
				g.stroke();
			});
		}
	}
}

function drawBark(g: Ctx, t: Geom, rand: () => number): void {
	for (let j = 0; j < t.cells; j++) {
		for (let i = 0; i < t.cells; i++) {
			if (rand() < 0.2) continue;
			const x = (i + 0.15 + rand() * 0.7) * t.cell;
			const y = (j + 0.15 + rand() * 0.7) * t.cell;
			const r = t.cell * (0.22 + rand() * 0.18);
			const n = 5 + Math.floor(rand() * 3);
			const spin = rand() * Math.PI * 2;
			const squash = 0.5 + rand() * 0.35;
			const rim: { x: number; y: number }[] = [];
			for (let k = 0; k < n; k++) {
				const a = spin + (k / n) * Math.PI * 2;
				const rk = r * (0.6 + rand() * 0.7);
				rim.push({ x: Math.cos(a) * rk, y: Math.sin(a) * rk * squash });
			}
			stamp(t.px, x, y, r * 1.4, (sx, sy) => {
				g.beginPath();
				rim.forEach((p, k) => {
					if (k === 0) g.moveTo(sx + p.x, sy + p.y);
					else g.lineTo(sx + p.x, sy + p.y);
				});
				g.closePath();
				g.stroke();
			});
		}
	}
}

function drawStone(g: Ctx, t: Geom): void {
	const seed = seedOf('stone');
	const jitter = 0.26;
	const shrink = 0.88;
	const corner = (i: number, j: number): { x: number; y: number } => {
		const wi = wrap(i, t.cells);
		const wj = wrap(j, t.cells);
		const jx = (hash2(wi, wj, seed) - 0.5) * 2 * jitter;
		const jy = (hash2(wi, wj, seed + 977) - 0.5) * 2 * jitter;
		return { x: (i + jx) * t.cell, y: (j + jy) * t.cell };
	};
	for (let j = -1; j <= t.cells; j++) {
		for (let i = -1; i <= t.cells; i++) {
			const quad = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
			let cx = 0;
			let cy = 0;
			for (const q of quad) {
				cx += q.x / 4;
				cy += q.y / 4;
			}
			g.beginPath();
			quad.forEach((q, k) => {
				const x = cx + (q.x - cx) * shrink;
				const y = cy + (q.y - cy) * shrink;
				if (k === 0) g.moveTo(x, y);
				else g.lineTo(x, y);
			});
			g.closePath();
			g.stroke();
		}
	}
}

const SPECS: Record<Exclude<PatternKind, 'none'>, Spec> = {
	grass: {
		cellM: GRASS_TUFT_M,
		cells: 4,
		minCells: 1,
		minCellPx: 6,
		alpha: 0.5,
		swatchCells: 3,
		draw: drawGrass
	},
	gravel: {
		cellM: GRAVEL_STONE_M,
		cells: 16,
		minCells: 1,
		minCellPx: 2.2,
		alpha: 0.45,
		swatchCells: 11,
		draw: drawGravel
	},
	paving: {
		cellM: PAVING_SLAB_M,
		cells: 4,
		minCells: 2,
		minCellPx: 8,
		alpha: 0.5,
		lineM: 0.008,
		swatchCells: 2,
		draw: drawPaving
	},
	deck: {
		cellM: DECK_BOARD_M,
		cells: 8,
		minCells: 4,
		minCellPx: 3,
		alpha: 0.45,
		swatchCells: 5,
		draw: drawDeck
	},
	water: {
		cellM: WATER_RIPPLE_M,
		cells: 8,
		minCells: 4,
		minCellPx: 4,
		alpha: 0.55,
		swatchCells: 4,
		draw: drawWater
	},
	soil: {
		cellM: SOIL_DASH_M,
		cells: 8,
		minCells: 1,
		minCellPx: 4,
		alpha: 0.6,
		lineM: 0.009,
		swatchCells: 4,
		draw: drawSoil
	},
	bark: {
		cellM: BARK_FLAKE_M,
		cells: 12,
		minCells: 1,
		minCellPx: 4,
		alpha: 0.55,
		swatchCells: 5,
		draw: drawBark
	},
	stone: {
		cellM: STONE_COBBLE_M,
		cells: 10,
		minCells: 2,
		minCellPx: 5,
		alpha: 0.5,
		swatchCells: 4,
		draw: drawStone
	}
};

function specOf(kind: PatternKind): Spec | null {
	return kind === 'none' ? null : SPECS[kind];
}

function quantiseScale(scale: number): number {
	return 2 ** (Math.round(Math.log2(scale) * QUANT_STEPS) / QUANT_STEPS);
}

function plan(spec: Spec, s: number, capPx: number): Geom {
	let cells = spec.cells;
	while (cells > spec.minCells && spec.cellM * cells * s > capPx) {
		const next = Math.max(spec.minCells, cells >> 1);
		if (next === cells) break;
		cells = next;
	}
	// Past the ceiling the motif is drawn a little under real size rather than allocating a huge tile.
	const px = clamp(Math.round(spec.cellM * cells * s), 1, HARD_TILE_PX);
	return { px, cells, cell: px / cells, s: px / (spec.cellM * cells) };
}

function createSurface(px: number): Surface | null {
	if (typeof OffscreenCanvas !== 'undefined') {
		const canvas = new OffscreenCanvas(px, px);
		const g = canvas.getContext('2d');
		return g ? { canvas, g } : null;
	}
	if (typeof document === 'undefined') return null;
	const canvas = document.createElement('canvas');
	canvas.width = px;
	canvas.height = px;
	const g = canvas.getContext('2d');
	return g ? { canvas, g } : null;
}

function renderTile(
	kind: PatternKind,
	colour: string,
	s: number
): { canvas: HTMLCanvasElement | OffscreenCanvas; px: number } | null {
	const spec = specOf(kind);
	if (!spec) return null;
	const t = plan(spec, s, TARGET_TILE_PX);
	const surface = createSurface(t.px);
	if (!surface) return null;
	const g = surface.g;
	g.globalAlpha = spec.alpha;
	g.strokeStyle = colour;
	g.fillStyle = colour;
	g.lineCap = 'round';
	g.lineJoin = 'round';
	g.lineWidth = clamp((spec.lineM ?? HATCH_LINE_M) * t.s, MIN_LINE_PX, MAX_LINE_PX);
	spec.draw(g, t, mulberry32(seedOf(kind)));
	return { canvas: surface.canvas, px: t.px };
}

const cache = new Map<string, CanvasPattern>();

/**
 * A CanvasPattern for the given material at the given zoom, cached.
 * `scale` is CSS pixels per metre, from View.scale. Returns null for 'none'.
 */
export function hatch(
	ctx: CanvasRenderingContext2D,
	kind: PatternKind,
	colour: string,
	scale: number,
	dpr: number
): CanvasPattern | null {
	const spec = specOf(kind);
	if (!spec || !Number.isFinite(scale) || scale <= 0) return null;
	const d = Number.isFinite(dpr) && dpr > 1 ? dpr : 1;
	const q = quantiseScale(scale);
	if (spec.cellM * q < spec.minCellPx) return null;
	const t = plan(spec, q * d, TARGET_TILE_PX);
	if (t.px < MIN_TILE_PX * d) return null;

	const key = `${kind}|${colour}|${q}|${d}`;
	const hit = cache.get(key);
	if (hit) return hit;

	const tile = renderTile(kind, colour, q * d);
	if (!tile) return null;
	const pattern = ctx.createPattern(tile.canvas, 'repeat');
	if (!pattern) return null;
	if (d !== 1 && typeof DOMMatrix !== 'undefined' && typeof pattern.setTransform === 'function') {
		pattern.setTransform(new DOMMatrix([1 / d, 0, 0, 1 / d, 0, 0]));
	}
	if (cache.size >= CACHE_LIMIT) cache.clear();
	cache.set(key, pattern);
	return pattern;
}

/** Drop every cached tile, e.g. when the canvas is recreated. */
export function clearPatternCache(): void {
	cache.clear();
}

/** A small swatch for the material palette, as a data URL. */
export function swatchDataUrl(kind: PatternKind, fill: string, stroke: string, size = 44): string {
	if (typeof document === 'undefined') return '';
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const g = canvas.getContext('2d');
	if (!g) return '';
	g.fillStyle = fill;
	g.fillRect(0, 0, size, size);
	const spec = specOf(kind);
	if (spec) {
		const tile = renderTile(kind, stroke, size / (spec.swatchCells * spec.cellM));
		const pattern = tile && g.createPattern(tile.canvas, 'repeat');
		if (pattern) {
			g.fillStyle = pattern;
			g.fillRect(0, 0, size, size);
		}
	}
	g.strokeStyle = stroke;
	g.lineWidth = 1;
	g.strokeRect(0.5, 0.5, size - 1, size - 1);
	return canvas.toDataURL();
}
