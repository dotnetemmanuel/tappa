import type { Hex, PropEntity } from '../doc/types.js';
import { between, rngFor, type Rng } from '../rng.js';
import { v, type Vec2 } from '../geom/vec2.js';
import type { Part, PropCat, PropDef, PropForm, PropInput } from './types.js';
import { propDefOr } from './catalog.js';

const WOOD: Hex = '#8a6a45';
const WOOD_DARK: Hex = '#6b5133';
const WOOD_PALE: Hex = '#a98a5f';
const FALU: Hex = '#7e3b2c';
const PAINT: Hex = '#e7e3d6';
const METAL: Hex = '#8d9297';
const METAL_DARK: Hex = '#5b6266';
const GLASS: Hex = '#bcd7e3';
const STONE: Hex = '#9b9b92';
const STONE_DARK: Hex = '#7c7c73';
const SOIL: Hex = '#5b4632';
const SAND: Hex = '#d9c79a';
const WATER: Hex = '#6f97a8';
const CANVAS: Hex = '#d8d2c2';
const ROPE: Hex = '#b9a67c';
const PLASTIC: Hex = '#3f4a45';
const FOLIAGE: Hex = '#6f8a52';
const TERRACOTTA: Hex = '#b3714e';
const EMBER: Hex = '#3a352f';
const FLAG_BLUE: Hex = '#2f5c96';
const FLAG_GOLD: Hex = '#dcb63c';

const GLASS_OPACITY = 0.25;

const PLAN_COLOURS: Record<PropCat, { fill: Hex; stroke: Hex }> = {
	sitting: { fill: '#d6c8ae', stroke: '#8a6a45' },
	growing: { fill: '#cfd8b8', stroke: '#6f8a52' },
	structure: { fill: '#d3cec2', stroke: '#7d7466' },
	play: { fill: '#d9c9c4', stroke: '#96736a' },
	utility: { fill: '#d2d4d0', stroke: '#7a8087' },
	water: { fill: '#c3d6dd', stroke: '#6f97a8' },
	nature: { fill: '#cfd0c4', stroke: '#7e8272' }
};

type V3 = [number, number, number];
type Opt = { rotY?: number; tiltX?: number; opacity?: number };

const box = (at: V3, size: V3, colour: Hex, o?: Opt): Part => ({
	shape: 'box',
	at,
	size,
	colour,
	...o
});

const cyl = (at: V3, dia: number, h: number, colour: Hex, o?: Opt): Part => ({
	shape: 'cyl',
	at,
	size: [dia, h, dia],
	colour,
	...o
});

const cone = (at: V3, dia: number, h: number, colour: Hex, o?: Opt): Part => ({
	shape: 'cone',
	at,
	size: [dia, h, dia],
	colour,
	...o
});

const ball = (at: V3, size: V3, colour: Hex, o?: Opt): Part => ({
	shape: 'sphere',
	at,
	size,
	colour,
	...o
});

type Q = Record<string, number>;
type Size = { w: number; d: number; h: number };
type Built = { parts: Part[]; size: Size; outline: Vec2[] };
type Builder = (q: Q, rng: Rng) => Built;

function num(q: Q, key: string, fallback: number): number {
	const x = q[key];
	return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

function rectOutline(w: number, d: number): Vec2[] {
	const x = w / 2;
	const y = d / 2;
	return [v(-x, -y), v(x, -y), v(x, y), v(-x, y)];
}

function sizeFromOutline(outline: readonly Vec2[], h: number): Size {
	const xs = outline.map((p) => p.x);
	const ys = outline.map((p) => p.y);
	return { w: Math.max(...xs) - Math.min(...xs), d: Math.max(...ys) - Math.min(...ys), h };
}

function roundOutline(dia: number, n = 24): Vec2[] {
	const r = dia / 2;
	const pts: Vec2[] = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		pts.push(v(Math.cos(a) * r, Math.sin(a) * r));
	}
	return pts;
}

/** A part rotated by `rotY` keeps its own x axis tangential to a circle at bearing `a`. */
const tangential = (a: number): number => -(a + Math.PI / 2);

/** Turning about +x lifts the +z edge, so the panel on the +z slope needs a negative tilt. */
const roofTilt = (side: number, pitch: number): number => -side * pitch;

function gableRoof(
	parts: Part[],
	len: number,
	width: number,
	eave: number,
	ridge: number,
	overhang: number,
	colour: Hex
): void {
	const pitch = Math.atan2(ridge - eave, width / 2);
	const slope = Math.hypot(width / 2 + overhang, ridge - eave);
	for (const side of [-1, 1]) {
		parts.push(
			box([0, (eave + ridge) / 2, (side * width) / 4], [len + overhang * 2, 0.05, slope], colour, {
				tiltX: roofTilt(side, pitch)
			})
		);
	}
	parts.push(box([0, ridge + 0.02, 0], [len + overhang * 2, 0.07, 0.09], colour));
}

function bench(q: Q): Built {
	const L = num(q, 'length', 1.6);
	const parts: Part[] = [];
	const legX = L / 2 - 0.16;
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1])
			parts.push(box([sx * legX, 0.22, sz * 0.2], [0.07, 0.44, 0.07], WOOD_DARK));
		parts.push(box([sx * legX, 0.67, -0.24], [0.07, 0.46, 0.07], WOOD_DARK));
	}
	for (const z of [-0.2, -0.02, 0.16]) parts.push(box([0, 0.46, z], [L, 0.045, 0.16], WOOD));
	for (const y of [0.7, 0.86]) parts.push(box([0, y, -0.26], [L - 0.1, 0.12, 0.04], WOOD));
	return { parts, size: { w: L, d: 0.6, h: 0.9 }, outline: rectOutline(L, 0.6) };
}

function picnicTable(q: Q): Built {
	const L = num(q, 'length', 1.8);
	const benchL = L * 0.9;
	const tableHalf = 0.375;
	const benchOut = 0.76;
	const parts: Part[] = [
		box([0, 0.74, 0], [L, 0.055, 0.75], WOOD),
		box([0, 0.46, -0.62], [benchL, 0.05, 0.28], WOOD),
		box([0, 0.46, 0.62], [benchL, 0.05, 0.28], WOOD),
		box([0, 0.2, 0], [L - 0.9, 0.08, 0.08], WOOD_DARK)
	];
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			parts.push(
				box([sx * (L / 2 - 0.3), 0.41, sz * 0.21], [0.09, 1.1, 0.09], WOOD_DARK, {
					tiltX: -sz * 0.837
				})
			);
		}
	}
	const x = benchL / 2;
	const outline = [
		v(-L / 2, -tableHalf),
		v(-x, -tableHalf),
		v(-x, -benchOut),
		v(x, -benchOut),
		v(x, -tableHalf),
		v(L / 2, -tableHalf),
		v(L / 2, tableHalf),
		v(x, tableHalf),
		v(x, benchOut),
		v(-x, benchOut),
		v(-x, tableHalf),
		v(-L / 2, tableHalf)
	];
	return { parts, size: { w: L, d: benchOut * 2, h: 0.76 }, outline };
}

function patioSet(q: Q, rng: Rng): Built {
	const seats = Math.max(2, Math.round(num(q, 'seats', 4)));
	const tableDia = 0.7 + (seats - 2) * 0.1;
	const r = tableDia / 2 + 0.42;
	const parts: Part[] = [
		cyl([0, 0.03, 0], 0.45, 0.06, METAL_DARK),
		cyl([0, 0.37, 0], 0.12, 0.68, METAL),
		cyl([0, 0.73, 0], tableDia, 0.05, WOOD_PALE)
	];
	for (let i = 0; i < seats; i++) {
		const a = (i / seats) * Math.PI * 2 + between(rng, -0.07, 0.07);
		const ux = Math.cos(a);
		const uz = Math.sin(a);
		const rot = tangential(a);
		parts.push(box([ux * r, 0.44, uz * r], [0.44, 0.05, 0.44], WOOD, { rotY: rot }));
		parts.push(box([ux * r, 0.24, uz * r], [0.38, 0.36, 0.38], WOOD_DARK, { rotY: rot }));
		parts.push(box([ux * (r + 0.2), 0.72, uz * (r + 0.2)], [0.44, 0.5, 0.06], WOOD, { rotY: rot }));
	}
	const dia = (r + 0.25) * 2;
	return { parts, size: { w: dia, d: dia, h: 0.95 }, outline: roundOutline(dia) };
}

function parasol(q: Q): Built {
	const D = num(q, 'diameter', 3);
	const parts: Part[] = [
		cyl([0, 0.04, 0], 0.55, 0.08, STONE_DARK),
		cyl([0, 1.2, 0], 0.055, 2.4, WOOD),
		cone([0, 2.32, 0], D, 0.5, CANVAS),
		ball([0, 2.62, 0], [0.09, 0.14, 0.09], WOOD_DARK)
	];
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		parts.push(
			box([(Math.cos(a) * D) / 4, 2.18, (Math.sin(a) * D) / 4], [D / 2, 0.03, 0.03], WOOD_PALE, {
				rotY: -a
			})
		);
	}
	return { parts, size: { w: D, d: D, h: 2.66 }, outline: roundOutline(D) };
}

function sunLounger(): Built {
	const parts: Part[] = [
		box([0, 0.34, 0.2], [0.62, 0.06, 1.3], WOOD),
		box([0, 0.4, 0.2], [0.56, 0.07, 1.24], CANVAS),
		box([0, 0.52, -0.7], [0.62, 0.06, 0.62], WOOD, { tiltX: 0.9 }),
		box([0.32, 0.5, 0.1], [0.05, 0.05, 0.9], WOOD_PALE),
		box([-0.32, 0.5, 0.1], [0.05, 0.05, 0.9], WOOD_PALE)
	];
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1])
			parts.push(box([sx * 0.28, 0.16, sz * 0.7], [0.05, 0.32, 0.05], WOOD_DARK));
	}
	return { parts, size: { w: 0.7, d: 1.9, h: 0.78 }, outline: rectOutline(0.7, 1.9) };
}

function hammock(q: Q, rng: Rng): Built {
	const L = num(q, 'length', 3.2);
	const parts: Part[] = [];
	for (const sx of [-1, 1]) {
		for (const t of [0.42, -0.42]) {
			parts.push(box([(sx * L) / 2, 0.65, 0], [0.09, 1.4, 0.09], WOOD, { tiltX: t }));
		}
		parts.push(box([(sx * L) / 2, 1.26, 0], [0.14, 0.12, 0.14], WOOD_DARK));
		parts.push(box([sx * (L / 2 - L * 0.12), 1.05, 0], [L * 0.2, 0.03, 0.03], ROPE));
	}
	const sag = between(rng, 0.5, 0.62);
	parts.push(box([0, sag, 0], [L * 0.36, 0.07, 0.52], CANVAS));
	for (const sx of [-1, 1]) {
		parts.push(box([sx * L * 0.28, sag + 0.19, 0], [L * 0.26, 0.06, 0.46], CANVAS));
	}
	return { parts, size: { w: L, d: 1.2, h: 1.32 }, outline: rectOutline(L, 1.2) };
}

function firePit(q: Q, rng: Rng): Built {
	const D = num(q, 'diameter', 1);
	const parts: Part[] = [cyl([0, 0.05, 0], D - 0.32, 0.1, EMBER)];
	const stones = 10;
	for (let i = 0; i < stones; i++) {
		const a = (i / stones) * Math.PI * 2;
		const r = (D - 0.16) / 2;
		const s = between(rng, 0.85, 1.15);
		parts.push(
			box(
				[Math.cos(a) * r, 0.11 * s, Math.sin(a) * r],
				[(Math.PI * D) / stones, 0.22 * s, 0.18],
				STONE,
				{
					rotY: tangential(a)
				}
			)
		);
	}
	for (let i = 0; i < 4; i++) {
		const a = between(rng, 0, Math.PI);
		parts.push(
			box(
				[between(rng, -0.1, 0.1), 0.14 + i * 0.05, between(rng, -0.1, 0.1)],
				[D * 0.6, 0.08, 0.08],
				WOOD_DARK,
				{ rotY: a }
			)
		);
	}
	return { parts, size: { w: D, d: D, h: 0.3 }, outline: roundOutline(D) };
}

function grill(): Built {
	const parts: Part[] = [
		ball([0, 0.78, 0], [0.6, 0.42, 0.6], PLASTIC),
		ball([0, 1, 0], [0.6, 0.3, 0.6], METAL_DARK),
		ball([0, 1.16, 0], [0.08, 0.08, 0.08], METAL),
		box([0.36, 0.86, 0], [0.16, 0.04, 0.04], METAL)
	];
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2;
		parts.push(cyl([Math.cos(a) * 0.26, 0.3, Math.sin(a) * 0.26], 0.035, 0.6, METAL_DARK));
	}
	return { parts, size: { w: 0.7, d: 0.7, h: 1.2 }, outline: roundOutline(0.7) };
}

function pot(q: Q): Built {
	const D = num(q, 'diameter', 0.45);
	const h = D * 0.85;
	const parts: Part[] = [
		cyl([0, h * 0.28, 0], D * 0.76, h * 0.56, TERRACOTTA),
		cyl([0, h * 0.74, 0], D, h * 0.44, TERRACOTTA),
		cyl([0, h - 0.01, 0], D * 1.06, 0.05, WOOD_PALE),
		cyl([0, h - 0.03, 0], D * 0.9, 0.04, SOIL),
		ball([0, h + D * 0.26, 0], [D * 1.15, D * 0.72, D * 1.15], FOLIAGE)
	];
	return { parts, size: { w: D * 1.15, d: D * 1.15, h: h + D * 0.62 }, outline: roundOutline(D) };
}

function planterBox(q: Q, rng: Rng): Built {
	const L = num(q, 'length', 1);
	const H = num(q, 'height', 0.5);
	const D = 0.4;
	const parts: Part[] = [
		box([0, H / 2, -D / 2 + 0.015], [L, H, 0.03], WOOD),
		box([0, H / 2, D / 2 - 0.015], [L, H, 0.03], WOOD),
		box([-L / 2 + 0.015, H / 2, 0], [0.03, H, D - 0.06], WOOD),
		box([L / 2 - 0.015, H / 2, 0], [0.03, H, D - 0.06], WOOD),
		box([0, H - 0.04, 0], [L - 0.08, 0.05, D - 0.1], SOIL)
	];
	for (const sx of [-1, 1]) {
		parts.push(box([sx * (L / 2 - 0.03), H / 2 + 0.02, 0], [0.06, H + 0.04, D], WOOD_DARK));
	}
	for (let i = 0; i < 3; i++) {
		const x = (i - 1) * (L / 3.4) + between(rng, -0.04, 0.04);
		const s = between(rng, 0.18, 0.28);
		parts.push(ball([x, H + s * 0.3, between(rng, -0.05, 0.05)], [s, s * 0.8, s], FOLIAGE));
	}
	return { parts, size: { w: L, d: D, h: H + 0.3 }, outline: rectOutline(L, D) };
}

function palletCollar(q: Q, rng: Rng): Built {
	const layers = Math.max(1, Math.round(num(q, 'layers', 2)));
	const H = layers * 0.2;
	const parts: Part[] = [];
	for (let i = 0; i < layers; i++) {
		const y = i * 0.2 + 0.1;
		for (const sz of [-1, 1]) parts.push(box([0, y, sz * 0.389], [1.2, 0.19, 0.022], WOOD_PALE));
		for (const sx of [-1, 1]) parts.push(box([sx * 0.589, y, 0], [0.022, 0.19, 0.756], WOOD_PALE));
	}
	parts.push(box([0, H - 0.04, 0], [1.15, 0.06, 0.75], SOIL));
	for (let i = 0; i < 6; i++) {
		const x = ((i % 3) - 1) * 0.34 + between(rng, -0.05, 0.05);
		const z = (Math.floor(i / 3) - 0.5) * 0.34 + between(rng, -0.04, 0.04);
		const s = between(rng, 0.16, 0.26);
		parts.push(ball([x, H + s * 0.25, z], [s, s * 0.75, s], FOLIAGE));
	}
	return { parts, size: { w: 1.2, d: 0.8, h: H + 0.25 }, outline: rectOutline(1.2, 0.8) };
}

function raisedBed(q: Q, rng: Rng): Built {
	const L = num(q, 'length', 2.4);
	const W = num(q, 'width', 1);
	const H = num(q, 'height', 0.4);
	const parts: Part[] = [
		box([0, H / 2, -W / 2 + 0.02], [L, H, 0.04], WOOD),
		box([0, H / 2, W / 2 - 0.02], [L, H, 0.04], WOOD),
		box([-L / 2 + 0.02, H / 2, 0], [0.04, H, W - 0.08], WOOD),
		box([L / 2 - 0.02, H / 2, 0], [0.04, H, W - 0.08], WOOD),
		box([0, H - 0.05, 0], [L - 0.1, 0.07, W - 0.1], SOIL)
	];
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			parts.push(
				box(
					[sx * (L / 2 - 0.04), H / 2 + 0.02, sz * (W / 2 - 0.04)],
					[0.08, H + 0.06, 0.08],
					WOOD_DARK
				)
			);
		}
	}
	const rows = Math.max(2, Math.round(L / 0.6));
	for (let i = 0; i < rows; i++) {
		const x = -L / 2 + ((i + 0.5) * L) / rows + between(rng, -0.03, 0.03);
		const s = between(rng, 0.2, 0.32);
		parts.push(
			ball([x, H + s * 0.25, between(rng, -W * 0.15, W * 0.15)], [s, s * 0.7, W * 0.6], FOLIAGE)
		);
	}
	return { parts, size: { w: L, d: W, h: H + 0.3 }, outline: rectOutline(L, W) };
}

function coldFrame(q: Q): Built {
	const L = num(q, 'length', 1.2);
	const D = 0.8;
	const parts: Part[] = [
		box([0, 0.275, -D / 2 + 0.015], [L, 0.55, 0.03], WOOD),
		box([0, 0.175, D / 2 - 0.015], [L, 0.35, 0.03], WOOD),
		box([-L / 2 + 0.015, 0.22, 0], [0.03, 0.44, D - 0.06], WOOD),
		box([L / 2 - 0.015, 0.22, 0], [0.03, 0.44, D - 0.06], WOOD),
		box([0, 0.2, 0], [L - 0.1, 0.06, D - 0.1], SOIL),
		box([0, 0.48, 0], [L, 0.03, D + 0.06], GLASS, { tiltX: 0.24, opacity: GLASS_OPACITY }),
		box([0, 0.55, -D / 2], [L, 0.06, 0.06], WOOD_DARK)
	];
	return { parts, size: { w: L, d: D, h: 0.6 }, outline: rectOutline(L, D) };
}

function compostBin(q: Q): Built {
	const W = num(q, 'width', 0.8);
	const parts: Part[] = [];
	for (const y of [0.15, 0.45, 0.75]) {
		for (const sz of [-1, 1]) parts.push(box([0, y, (sz * (W - 0.03)) / 2], [W, 0.14, 0.03], WOOD));
		for (const sx of [-1, 1]) {
			parts.push(box([(sx * (W - 0.03)) / 2, y, 0], [0.03, 0.14, W - 0.06], WOOD));
		}
	}
	parts.push(box([0, 0.92, 0], [W + 0.06, 0.04, W + 0.06], PLASTIC));
	return { parts, size: { w: W, d: W, h: 0.94 }, outline: rectOutline(W, W) };
}

function trellis(q: Q): Built {
	const W = num(q, 'width', 1.2);
	const H = num(q, 'height', 1.8);
	const parts: Part[] = [
		box([-W / 2 + 0.03, H / 2, 0], [0.06, H, 0.04], WOOD),
		box([W / 2 - 0.03, H / 2, 0], [0.06, H, 0.04], WOOD)
	];
	const verticals = Math.max(3, Math.round(W / 0.25));
	for (let i = 1; i < verticals; i++) {
		parts.push(box([-W / 2 + (i * W) / verticals, H / 2, 0], [0.028, H - 0.08, 0.02], WOOD_PALE));
	}
	const rungs = Math.max(3, Math.round(H / 0.45));
	for (let i = 1; i < rungs; i++) {
		parts.push(box([0, (i * H) / rungs, 0], [W - 0.06, 0.028, 0.02], WOOD_PALE));
	}
	return { parts, size: { w: W, d: 0.08, h: H }, outline: rectOutline(W, 0.08) };
}

function greenhouse(q: Q): Built {
	const L = num(q, 'length', 3.6);
	const W = num(q, 'width', 2.4);
	const R = num(q, 'height', 2.4);
	const eave = Math.max(1.4, R - 0.6);
	const parts: Part[] = [
		box([0, 0.06, 0], [L + 0.1, 0.12, W + 0.1], STONE_DARK),
		box([0, eave / 2, -W / 2], [L, eave, 0.02], GLASS, { opacity: GLASS_OPACITY }),
		box([0, eave / 2, W / 2], [L, eave, 0.02], GLASS, { opacity: GLASS_OPACITY }),
		box([-L / 2, eave / 2, 0], [0.02, eave, W], GLASS, { opacity: GLASS_OPACITY }),
		box([L / 2, eave / 2, 0], [0.02, eave, W], GLASS, { opacity: GLASS_OPACITY }),
		box([0, eave, -W / 2], [L, 0.06, 0.06], METAL),
		box([0, eave, W / 2], [L, 0.06, 0.06], METAL),
		box([L / 2 + 0.02, 0.95, 0], [0.06, 1.9, 0.78], METAL)
	];
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			parts.push(
				box([sx * (L / 2 - 0.035), eave / 2, sz * (W / 2 - 0.035)], [0.07, eave, 0.07], METAL)
			);
		}
		parts.push(
			box([sx * L * 0.5, (eave + R) / 2 - 0.05, 0], [0.02, (R - eave) * 0.8, W * 0.55], GLASS, {
				opacity: GLASS_OPACITY
			})
		);
	}
	const pitch = Math.atan2(R - eave, W / 2);
	const slope = Math.hypot(W / 2, R - eave);
	for (const side of [-1, 1]) {
		parts.push(
			box([0, (eave + R) / 2, (side * W) / 4], [L, 0.03, slope], GLASS, {
				tiltX: roofTilt(side, pitch),
				opacity: GLASS_OPACITY + 0.1
			})
		);
	}
	parts.push(box([0, R, 0], [L, 0.07, 0.07], METAL));
	return { parts, size: { w: L, d: W, h: R }, outline: rectOutline(L, W) };
}

function shed(q: Q): Built {
	const L = num(q, 'length', 3);
	const W = num(q, 'width', 2.4);
	const H = num(q, 'height', 2.1);
	const ridge = H + W * 0.22;
	const parts: Part[] = [
		box([0, 0.07, 0], [L + 0.12, 0.14, W + 0.12], STONE_DARK),
		box([0, H / 2, -W / 2 + 0.02], [L, H, 0.04], FALU),
		box([0, H / 2, W / 2 - 0.02], [L, H, 0.04], FALU),
		box([-L / 2 + 0.02, H / 2, 0], [0.04, H, W - 0.04], FALU),
		box([L / 2 - 0.02, H / 2, 0], [0.04, H, W - 0.04], FALU),
		box([L / 2 + 0.03, H * 0.45, 0], [0.03, H * 0.9, 0.85], PAINT),
		box([L * 0.25, H * 0.62, W / 2 + 0.03], [0.55, 0.5, 0.03], GLASS, { opacity: 0.4 })
	];
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			parts.push(box([sx * (L / 2 - 0.05), H / 2, sz * (W / 2 - 0.05)], [0.1, H, 0.1], PAINT));
		}
		parts.push(box([sx * L * 0.5, (H + ridge) / 2, 0], [0.04, ridge - H, W * 0.72], FALU));
	}
	gableRoof(parts, L, W, H, ridge, 0.18, WOOD_DARK);
	return { parts, size: { w: L, d: W, h: ridge }, outline: rectOutline(L, W) };
}

function pergola(q: Q): Built {
	const L = num(q, 'length', 4);
	const W = num(q, 'width', 3);
	const H = num(q, 'height', 2.4);
	const parts: Part[] = [];
	const posts = L > 4.5 ? 3 : 2;
	for (let i = 0; i < posts; i++) {
		const x = -L / 2 + (i * L) / (posts - 1);
		for (const sz of [-1, 1]) parts.push(box([x, H / 2, (sz * W) / 2], [0.12, H, 0.12], WOOD));
	}
	for (const sz of [-1, 1]) {
		parts.push(box([0, H - 0.08, (sz * W) / 2], [L + 0.3, 0.16, 0.09], WOOD_PALE));
	}
	const rafters = Math.min(12, Math.max(4, Math.round(L / 0.55) + 1));
	for (let i = 0; i < rafters; i++) {
		const x = -L / 2 + (i * L) / (rafters - 1);
		parts.push(box([x, H + 0.06, 0], [0.07, 0.12, W + 0.4], WOOD_PALE));
	}
	for (const z of [-W * 0.28, 0, W * 0.28]) {
		parts.push(box([0, H + 0.14, z], [L + 0.3, 0.04, 0.05], WOOD_PALE));
	}
	return { parts, size: { w: L, d: W, h: H + 0.16 }, outline: rectOutline(L, W) };
}

function gazebo(q: Q): Built {
	const D = num(q, 'diameter', 3);
	const deck = D - 0.5;
	const r = deck / 2 - 0.12;
	const eave = 2.35;
	const parts: Part[] = [cyl([0, 0.08, 0], deck, 0.16, WOOD_PALE)];
	const sides = 6;
	for (let i = 0; i < sides; i++) {
		const a = (i / sides) * Math.PI * 2;
		parts.push(box([Math.cos(a) * r, 1.25, Math.sin(a) * r], [0.11, 2.2, 0.11], WOOD));
		const mid = a + Math.PI / sides;
		const chord = 2 * r * Math.sin(Math.PI / sides);
		const inset = r * Math.cos(Math.PI / sides);
		parts.push(
			box([Math.cos(mid) * inset, 0.75, Math.sin(mid) * inset], [chord, 0.5, 0.06], WOOD_PALE, {
				rotY: tangential(mid)
			})
		);
	}
	parts.push(cone([0, eave + 0.48, 0], D, 0.95, WOOD_DARK));
	parts.push(ball([0, eave + 1.02, 0], [0.16, 0.22, 0.16], WOOD_DARK));
	return { parts, size: { w: D, d: D, h: eave + 1.1 }, outline: roundOutline(D) };
}

function dogHouse(): Built {
	const parts: Part[] = [
		box([0, 0.3, 0], [1, 0.6, 0.7], WOOD),
		box([0, 0.21, 0.351], [0.34, 0.42, 0.02], EMBER)
	];
	gableRoof(parts, 1, 0.7, 0.6, 0.88, 0.08, FALU);
	return { parts, size: { w: 1, d: 0.7, h: 0.88 }, outline: rectOutline(1, 0.7) };
}

function playhouse(q: Q): Built {
	const W = num(q, 'width', 1.6);
	const D = W * 0.9;
	const H = 1.35;
	const ridge = H + D * 0.3;
	const parts: Part[] = [
		box([0, H / 2, -D / 2 + 0.02], [W, H, 0.04], FALU),
		box([0, H / 2, D / 2 - 0.02], [W, H, 0.04], FALU),
		box([-W / 2 + 0.02, H / 2, 0], [0.04, H, D - 0.04], FALU),
		box([W / 2 - 0.02, H / 2, 0], [0.04, H, D - 0.04], FALU),
		box([0, H * 0.4, D / 2 + 0.03], [0.5, H * 0.8, 0.03], PAINT),
		box([W / 2 + 0.03, H * 0.62, 0], [0.03, 0.4, 0.4], GLASS, { opacity: 0.4 })
	];
	for (const sx of [-1, 1]) {
		parts.push(box([(sx * W) / 2, (H + ridge) / 2, 0], [0.04, ridge - H, D * 0.7], FALU));
	}
	gableRoof(parts, W, D, H, ridge, 0.12, WOOD_DARK);
	return { parts, size: { w: W, d: D, h: ridge }, outline: rectOutline(W, D) };
}

function trampoline(q: Q): Built {
	const D = num(q, 'diameter', 3);
	const parts: Part[] = [
		cyl([0, 0.82, 0], D - 0.34, 0.03, '#2f3a3d'),
		cyl([0, 0.88, 0], D, 0.14, '#4f6d7a')
	];
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI * 2;
		const r = D / 2 - 0.06;
		parts.push(cyl([Math.cos(a) * r, 0.4, Math.sin(a) * r], 0.05, 0.8, METAL));
	}
	return { parts, size: { w: D, d: D, h: 0.95 }, outline: roundOutline(D) };
}

function sandpit(q: Q): Built {
	const W = num(q, 'width', 1.5);
	const parts: Part[] = [
		box([0, 0.09, 0], [W - 0.24, 0.18, W - 0.24], SAND),
		box([0, 0.125, -W / 2 + 0.06], [W, 0.25, 0.12], WOOD),
		box([0, 0.125, W / 2 - 0.06], [W, 0.25, 0.12], WOOD),
		box([-W / 2 + 0.06, 0.125, 0], [0.12, 0.25, W - 0.24], WOOD),
		box([W / 2 - 0.06, 0.125, 0], [0.12, 0.25, W - 0.24], WOOD)
	];
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			parts.push(
				box([sx * (W / 2 - 0.17), 0.27, sz * (W / 2 - 0.17)], [0.34, 0.05, 0.34], WOOD_PALE)
			);
		}
	}
	return { parts, size: { w: W, d: W, h: 0.3 }, outline: rectOutline(W, W) };
}

function swingSet(q: Q): Built {
	const W = num(q, 'width', 2.5);
	const H = num(q, 'height', 2.3);
	const splay = 0.34;
	const legLen = H / Math.cos(splay);
	const parts: Part[] = [box([0, H, 0], [W + 0.24, 0.13, 0.13], WOOD)];
	for (const sx of [-1, 1]) {
		for (const t of [splay, -splay]) {
			parts.push(box([(sx * W) / 2, H / 2, 0], [0.1, legLen, 0.1], WOOD, { tiltX: t }));
		}
	}
	for (const sx of [-1, 1]) {
		const x = sx * W * 0.22;
		parts.push(box([x, 0.45, 0], [0.46, 0.05, 0.2], PLASTIC));
		for (const dx of [-0.19, 0.19]) {
			parts.push(box([x + dx, (H + 0.45) / 2, 0], [0.03, H - 0.45, 0.03], ROPE));
		}
	}
	const d = 2 * H * Math.tan(splay) + 0.2;
	return { parts, size: { w: W + 0.24, d, h: H }, outline: rectOutline(W + 0.24, d) };
}

function footballGoal(q: Q): Built {
	const W = num(q, 'width', 3);
	const H = Math.min(2.44, Math.max(1, W * 0.55));
	const lean = 0.4;
	const depth = H * Math.tan(lean);
	const parts: Part[] = [
		box([0, H, 0], [W + 0.09, 0.09, 0.09], PAINT),
		box([0, H / 2, -depth / 2], [W, H, depth], PAINT, { opacity: 0.14 })
	];
	for (const sx of [-1, 1]) {
		parts.push(cyl([(sx * W) / 2, H / 2, 0], 0.09, H, PAINT));
		parts.push(
			box([(sx * W) / 2, H / 2, -depth / 2], [0.06, H / Math.cos(lean), 0.06], PAINT, {
				tiltX: lean
			})
		);
	}
	const d = depth + 0.1;
	const x = (W + 0.09) / 2;
	const outline = [v(-x, -depth), v(x, -depth), v(x, 0.1), v(-x, 0.1)];
	return { parts, size: { w: W + 0.09, d, h: H }, outline };
}

function flagpole(q: Q): Built {
	const H = num(q, 'height', 7);
	const flagH = Math.min(1.4, H * 0.18);
	const flagW = flagH * 1.6;
	const flagY = H - 0.35 - flagH / 2;
	const x0 = 0.06;
	const parts: Part[] = [
		cyl([0, 0.09, 0], 0.45, 0.18, STONE),
		cyl([0, 0.18 + H * 0.28, 0], 0.12, H * 0.56, PAINT),
		cyl([0, 0.18 + H * 0.56 + H * 0.22, 0], 0.075, H * 0.44, PAINT),
		ball([0, H + 0.24, 0], [0.13, 0.15, 0.13], FLAG_GOLD),
		box([x0 + flagW / 2, flagY, 0], [flagW, flagH, 0.015], FLAG_BLUE),
		box([x0 + flagW * 0.34, flagY, 0.01], [flagW * 0.13, flagH, 0.015], FLAG_GOLD),
		box([x0 + flagW / 2, flagY, 0.01], [flagW, flagH * 0.2, 0.015], FLAG_GOLD)
	];
	return { parts, size: { w: 0.45, d: 0.45, h: H + 0.3 }, outline: roundOutline(0.45) };
}

function rotaryDryer(q: Q): Built {
	const D = num(q, 'diameter', 2.6);
	const parts: Part[] = [
		cyl([0, 0.1, 0], 0.16, 0.2, METAL_DARK),
		cyl([0, 0.95, 0], 0.06, 1.9, METAL),
		ball([0, 1.94, 0], [0.1, 0.1, 0.1], METAL_DARK)
	];
	for (let i = 0; i < 4; i++) {
		const a = (i / 4) * Math.PI;
		parts.push(box([0, 1.78 - i * 0.02, 0], [D, 0.04, 0.04], METAL, { rotY: -a }));
	}
	return { parts, size: { w: D, d: D, h: 1.95 }, outline: roundOutline(D) };
}

function logPile(q: Q, rng: Rng): Built {
	const L = num(q, 'length', 2);
	const H = num(q, 'height', 1.2);
	const D = 0.5;
	const parts: Part[] = [box([0, H / 2, -0.06], [L, H, D * 0.75], WOOD_DARK)];
	for (const sx of [-1, 1]) {
		parts.push(
			box([sx * (L / 2 + 0.05), H / 2 + 0.05, 0], [0.08, H + 0.1, D], WOOD, { tiltX: sx * 0.03 })
		);
	}
	const logs = Math.min(22, Math.max(8, Math.round((L * H) / 0.11)));
	for (let i = 0; i < logs; i++) {
		const dia = between(rng, 0.09, 0.17);
		const x = between(rng, -L / 2 + dia, L / 2 - dia);
		const lean = between(rng, -0.03, 0.03) * (1 - Math.abs(x) / L);
		const y = between(rng, dia / 2, H - dia / 2) + lean;
		const pale = rng() < 0.5;
		parts.push(
			cyl([x, y, D * 0.36], dia, D * 0.9, pale ? WOOD_PALE : WOOD, { tiltX: Math.PI / 2 })
		);
	}
	return { parts, size: { w: L + 0.2, d: D, h: H + 0.1 }, outline: rectOutline(L + 0.2, D) };
}

function bikeRack(q: Q): Built {
	const places = Math.max(2, Math.round(num(q, 'places', 4)));
	const W = places * 0.4;
	const parts: Part[] = [
		box([0, 0.05, -0.3], [W, 0.05, 0.05], METAL),
		box([0, 0.05, 0.3], [W, 0.05, 0.05], METAL)
	];
	for (let i = 0; i < places; i++) {
		const x = -W / 2 + (i + 0.5) * 0.4;
		for (const dx of [-0.055, 0.055]) parts.push(cyl([x + dx, 0.21, 0], 0.04, 0.42, METAL));
	}
	return { parts, size: { w: W, d: 0.7, h: 0.42 }, outline: rectOutline(W, 0.7) };
}

function mailbox(): Built {
	const parts: Part[] = [
		box([0, 0.52, 0], [0.09, 1.04, 0.09], WOOD),
		box([0, 1.22, 0], [0.4, 0.28, 0.32], METAL_DARK),
		box([0, 1.37, 0], [0.42, 0.04, 0.34], METAL),
		box([0, 1.24, 0.17], [0.24, 0.03, 0.02], PAINT),
		box([0.22, 1.28, 0], [0.03, 0.16, 0.02], FALU)
	];
	return { parts, size: { w: 0.4, d: 0.35, h: 1.4 }, outline: rectOutline(0.4, 0.35) };
}

function wheelieBin(q: Q): Built {
	const n = Math.max(1, Math.round(num(q, 'count', 1)));
	const pitch = 0.66;
	const W = n * pitch;
	const parts: Part[] = [];
	for (let i = 0; i < n; i++) {
		const x = (i - (n - 1) / 2) * pitch;
		parts.push(box([x, 0.48, 0], [0.58, 0.9, 0.72], PLASTIC));
		parts.push(box([x, 0.96, -0.02], [0.6, 0.06, 0.74], METAL_DARK));
		for (const dx of [-0.24, 0.24]) {
			parts.push(cyl([x + dx, 0.1, -0.28], 0.2, 0.05, EMBER, { tiltX: Math.PI / 2 }));
		}
	}
	return { parts, size: { w: W, d: 0.75, h: 1 }, outline: rectOutline(W, 0.75) };
}

function steppingStones(q: Q, rng: Rng): Built {
	const n = Math.max(2, Math.round(num(q, 'count', 6)));
	const s = num(q, 'size', 0.4);
	const pitch = s + 0.25;
	const parts: Part[] = [];
	const top: Vec2[] = [];
	const bottom: Vec2[] = [];
	let first = v(0, 0);
	let last = v(0, 0);
	for (let i = 0; i < n; i++) {
		const dia = s * between(rng, 0.85, 1.15);
		const x = (i - (n - 1) / 2) * pitch + between(rng, -0.05, 0.05);
		const z = between(rng, -0.1, 0.1);
		parts.push(
			cyl([x, 0.04, z], dia, 0.08, i % 2 === 0 ? STONE : STONE_DARK, { rotY: rng() * Math.PI })
		);
		top.push(v(x, z + dia / 2));
		bottom.push(v(x, z - dia / 2));
		if (i === 0) first = v(x - dia / 2, z);
		last = v(x + dia / 2, z);
	}
	const outline = [first, ...bottom, last, ...top.reverse()];
	return { parts, size: sizeFromOutline(outline, 0.08), outline };
}

function lantern(q: Q): Built {
	const H = num(q, 'height', 1);
	const postH = H - 0.28;
	const parts: Part[] = [
		cyl([0, 0.02, 0], 0.22, 0.04, METAL_DARK),
		cyl([0, 0.04 + postH / 2, 0], 0.055, postH, METAL_DARK),
		box([0, H - 0.14, 0], [0.16, 0.2, 0.16], '#f2e2b8', { opacity: 0.55 }),
		box([0, H - 0.25, 0], [0.19, 0.03, 0.19], METAL_DARK),
		box([0, H - 0.03, 0], [0.19, 0.03, 0.19], METAL_DARK),
		cone([0, H + 0.06, 0], 0.26, 0.12, METAL_DARK)
	];
	return { parts, size: { w: 0.3, d: 0.3, h: H + 0.12 }, outline: roundOutline(0.3) };
}

function bollardLight(q: Q): Built {
	const H = num(q, 'height', 0.8);
	const parts: Part[] = [
		cyl([0, 0.015, 0], 0.17, 0.03, METAL_DARK),
		cyl([0, H / 2, 0], 0.09, H, METAL),
		cyl([0, H - 0.09, 0], 0.1, 0.09, '#f2e2b8', { opacity: 0.55 }),
		cyl([0, H + 0.01, 0], 0.13, 0.04, METAL_DARK)
	];
	return { parts, size: { w: 0.18, d: 0.18, h: H + 0.03 }, outline: roundOutline(0.18) };
}

function heatPump(): Built {
	const parts: Part[] = [
		box([0, 0.42, 0], [0.9, 0.62, 0.33], METAL),
		cyl([0, 0.45, 0.17], 0.44, 0.04, METAL_DARK, { tiltX: Math.PI / 2 }),
		cyl([0, 0.45, 0.2], 0.12, 0.04, PLASTIC, { tiltX: Math.PI / 2 }),
		box([-0.35, 0.055, 0], [0.1, 0.11, 0.36], METAL_DARK),
		box([0.35, 0.055, 0], [0.1, 0.11, 0.36], METAL_DARK)
	];
	return { parts, size: { w: 0.9, d: 0.4, h: 0.73 }, outline: rectOutline(0.9, 0.4) };
}

function hotTub(q: Q): Built {
	const D = num(q, 'diameter', 2);
	const wall = 1;
	const parts: Part[] = [cyl([0, wall / 2, 0], D - 0.1, wall, WOOD_DARK)];
	const staves = 14;
	for (let i = 0; i < staves; i++) {
		const a = (i / staves) * Math.PI * 2;
		const r = D / 2 - 0.025;
		parts.push(
			box(
				[Math.cos(a) * r, wall / 2, Math.sin(a) * r],
				[(Math.PI * D) / staves + 0.01, wall, 0.05],
				WOOD,
				{
					rotY: tangential(a)
				}
			)
		);
	}
	for (const y of [0.24, 0.76]) parts.push(cyl([0, y, 0], D + 0.02, 0.05, METAL_DARK));
	parts.push(cyl([0, wall + 0.04, 0], D + 0.06, 0.09, WOOD_PALE));
	parts.push(cyl([0, wall + 0.09, 0], D - 0.22, 0.03, WATER, { opacity: 0.9 }));
	return { parts, size: { w: D + 0.06, d: D + 0.06, h: wall + 0.11 }, outline: roundOutline(D) };
}

function waterButt(q: Q): Built {
	const D = num(q, 'diameter', 0.6);
	const H = 0.9;
	const parts: Part[] = [
		cyl([0, H / 2, 0], D, H, PLASTIC),
		cyl([0, H * 0.3, 0], D + 0.03, 0.04, METAL_DARK),
		cyl([0, H * 0.7, 0], D + 0.03, 0.04, METAL_DARK),
		cyl([0, H + 0.02, 0], D + 0.05, 0.05, METAL_DARK),
		box([0, 0.16, D / 2], [0.06, 0.06, 0.12], METAL)
	];
	return { parts, size: { w: D + 0.05, d: D + 0.05, h: H + 0.05 }, outline: roundOutline(D) };
}

function birdBath(): Built {
	const parts: Part[] = [
		cyl([0, 0.03, 0], 0.36, 0.06, STONE_DARK),
		cyl([0, 0.4, 0], 0.13, 0.7, STONE),
		cyl([0, 0.79, 0], 0.5, 0.1, STONE),
		cyl([0, 0.84, 0], 0.42, 0.02, WATER, { opacity: 0.9 })
	];
	return { parts, size: { w: 0.5, d: 0.5, h: 0.85 }, outline: roundOutline(0.5) };
}

function pool(q: Q): Built {
	const L = num(q, 'length', 6);
	const W = num(q, 'width', 3);
	const H = 1.15;
	const parts: Part[] = [
		box([0, H / 2, -W / 2 + 0.04], [L, H, 0.08], METAL),
		box([0, H / 2, W / 2 - 0.04], [L, H, 0.08], METAL),
		box([-L / 2 + 0.04, H / 2, 0], [0.08, H, W - 0.16], METAL),
		box([L / 2 - 0.04, H / 2, 0], [0.08, H, W - 0.16], METAL),
		box([0, H - 0.12, 0], [L - 0.16, 0.08, W - 0.16], WATER, { opacity: 0.85 }),
		box([0, H + 0.03, -W / 2 + 0.09], [L + 0.2, 0.06, 0.22], WOOD_PALE),
		box([0, H + 0.03, W / 2 - 0.09], [L + 0.2, 0.06, 0.22], WOOD_PALE),
		box([-L / 2 + 0.09, H + 0.03, 0], [0.22, 0.06, W - 0.2], WOOD_PALE),
		box([L / 2 - 0.09, H + 0.03, 0], [0.22, 0.06, W - 0.2], WOOD_PALE)
	];
	for (const dz of [-0.2, 0.2]) {
		parts.push(cyl([L / 2 - 0.3, H + 0.35, dz], 0.05, 0.8, METAL));
	}
	parts.push(box([L / 2 - 0.3, H + 0.02, 0], [0.3, 0.04, 0.44], METAL));
	return {
		parts,
		size: { w: L + 0.2, d: W + 0.2, h: H + 0.75 },
		outline: rectOutline(L + 0.2, W + 0.2)
	};
}

function boulder(q: Q, rng: Rng): Built {
	const D = num(q, 'diameter', 0.9);
	const h = D * between(rng, 0.55, 0.8);
	const parts: Part[] = [
		ball([0, h / 2, 0], [D, h, D * between(rng, 0.82, 1)], STONE, { rotY: rng() * Math.PI }),
		ball(
			[between(rng, -0.15, 0.15) * D, h * 0.35, between(rng, -0.2, 0.2) * D],
			[D * 0.6, h * 0.7, D * 0.55],
			STONE_DARK,
			{ rotY: rng() * Math.PI }
		),
		ball(
			[between(rng, -0.25, 0.25) * D, h * 0.25, between(rng, -0.25, 0.25) * D],
			[D * 0.4, h * 0.5, D * 0.4],
			STONE
		)
	];
	const outline: Vec2[] = [];
	for (let i = 0; i < 14; i++) {
		const a = (i / 14) * Math.PI * 2;
		const r = (D / 2) * between(rng, 0.82, 1.04);
		outline.push(v(Math.cos(a) * r, Math.sin(a) * r));
	}
	return { parts, size: sizeFromOutline(outline, h), outline };
}

function birdTable(q: Q): Built {
	const H = num(q, 'height', 1.5);
	const ridge = H + 0.42;
	const parts: Part[] = [
		cyl([0, H / 2, 0], 0.08, H, WOOD),
		box([0, 0.03, 0], [0.5, 0.06, 0.08], WOOD_DARK),
		box([0, 0.03, 0], [0.08, 0.06, 0.5], WOOD_DARK),
		box([0, H, 0], [0.44, 0.04, 0.44], WOOD_PALE)
	];
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			parts.push(box([sx * 0.19, H + 0.15, sz * 0.19], [0.03, 0.26, 0.03], WOOD));
		}
	}
	gableRoof(parts, 0.5, 0.5, H + 0.28, ridge, 0.05, WOOD_DARK);
	return { parts, size: { w: 0.5, d: 0.5, h: ridge }, outline: rectOutline(0.5, 0.5) };
}

function insectHotel(): Built {
	const parts: Part[] = [
		box([-0.2, 0.2, 0], [0.06, 0.4, 0.06], WOOD_DARK),
		box([0.2, 0.2, 0], [0.06, 0.4, 0.06], WOOD_DARK),
		box([0, 0.75, 0], [0.5, 0.72, 0.18], WOOD),
		box([0, 0.55, 0.01], [0.42, 0.18, 0.16], '#c8a86a'),
		box([0, 0.75, 0.01], [0.42, 0.18, 0.16], WOOD_DARK),
		box([0, 0.95, 0.01], [0.42, 0.18, 0.16], WOOD_PALE),
		box([0, 1.14, 0], [0.6, 0.04, 0.26], FALU, { tiltX: 0.2 })
	];
	return { parts, size: { w: 0.6, d: 0.26, h: 1.18 }, outline: rectOutline(0.5, 0.2) };
}

const BUILDERS = new Map<string, Builder>([
	['bench', bench],
	['picnic-table', picnicTable],
	['patio-set', patioSet],
	['parasol', parasol],
	['sun-lounger', sunLounger],
	['hammock', hammock],
	['fire-pit', firePit],
	['grill', grill],
	['pot-small', pot],
	['pot-medium', pot],
	['pot-large', pot],
	['planter-box', planterBox],
	['pallet-collar', palletCollar],
	['raised-bed', raisedBed],
	['cold-frame', coldFrame],
	['compost-bin', compostBin],
	['trellis', trellis],
	['greenhouse', greenhouse],
	['shed', shed],
	['pergola', pergola],
	['gazebo', gazebo],
	['dog-house', dogHouse],
	['playhouse', playhouse],
	['trampoline', trampoline],
	['sandpit', sandpit],
	['swing-set', swingSet],
	['football-goal', footballGoal],
	['flagpole', flagpole],
	['rotary-dryer', rotaryDryer],
	['log-pile', logPile],
	['bike-rack', bikeRack],
	['mailbox', mailbox],
	['wheelie-bin', wheelieBin],
	['stepping-stones', steppingStones],
	['lantern', lantern],
	['bollard-light', bollardLight],
	['heat-pump', heatPump],
	['hot-tub', hotTub],
	['water-butt', waterButt],
	['bird-bath', birdBath],
	['pool', pool],
	['boulder', boulder],
	['bird-table', birdTable],
	['insect-hotel', insectHotel]
]);

function crate(def: PropDef): Built {
	const { w, d } = def.footprint;
	const h = Math.min(w, d) * 0.8;
	return {
		parts: [box([0, h / 2, 0], [w, h, d], WOOD)],
		size: { w, d, h },
		outline: def.planShape === 'round' ? roundOutline(Math.max(w, d)) : rectOutline(w, d)
	};
}

/** Merge the entity's stored params over the definition defaults. */
export function paramsFor(def: PropDef, stored?: Record<string, number>): Record<string, number> {
	const out: Record<string, number> = {};
	for (const p of def.params) {
		const raw = stored?.[p.key];
		out[p.key] =
			typeof raw === 'number' && Number.isFinite(raw)
				? Math.min(p.max, Math.max(p.min, raw))
				: p.default;
	}
	return out;
}

/** Build the parts for one prop at the given parameters. Deterministic for a given rng seed. */
export function propForm(input: PropInput): PropForm {
	const { def } = input;
	const build = BUILDERS.get(def.id);
	const built = build ? build(paramsFor(def, input.params), input.rng) : crate(def);
	const plan = PLAN_COLOURS[def.cat];
	return {
		parts: built.parts,
		size: built.size,
		outline: built.outline,
		stroke: plan.stroke,
		fill: plan.fill
	};
}

/** Convenience for a document entity, seeding the rng from the entity id. */
export function formForProp(prop: PropEntity): PropForm {
	const def = propDefOr(prop.kind);
	return propForm({ def, params: paramsFor(def, prop.params), rng: rngFor(prop.id) });
}
