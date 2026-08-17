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

const LEAF_LIGHT: Hex = '#84a35f';
const LEAF_DARK: Hex = '#57733f';

/**
 * Something growing in a bed: a low rosette of leaves rather than one green ball, with a
 * couple of taller shoots. Small enough to repeat a dozen times without costing anything.
 */
function crop(parts: Part[], x: number, y: number, z: number, size: number, rng: Rng): void {
	const leaves = 4 + Math.floor(rng() * 3);
	for (let i = 0; i < leaves; i++) {
		const a = (i / leaves) * Math.PI * 2 + between(rng, -0.3, 0.3);
		const d = size * between(rng, 0.28, 0.5);
		const r = size * between(rng, 0.34, 0.5);
		parts.push(
			ball(
				[x + Math.cos(a) * d, y + r * between(rng, 0.35, 0.6), z + Math.sin(a) * d],
				[r, r * between(rng, 0.4, 0.6), r * 0.75],
				i % 2 === 0 ? FOLIAGE : LEAF_LIGHT,
				{ rotY: -a }
			)
		);
	}
	const shoots = 1 + Math.floor(rng() * 2);
	for (let i = 0; i < shoots; i++) {
		const a = rng() * Math.PI * 2;
		const d = size * between(rng, 0, 0.25);
		const h = size * between(rng, 0.9, 1.5);
		parts.push(cyl([x + Math.cos(a) * d, y + h / 2, z + Math.sin(a) * d], size * 0.09, h, LEAF_DARK));
		parts.push(
			ball(
				[x + Math.cos(a) * d, y + h, z + Math.sin(a) * d],
				[size * 0.36, size * 0.3, size * 0.36],
				LEAF_LIGHT
			)
		);
	}
}

/** Boards with a gap between them, which is what a shed wall, a fence or a bin is made of. */
function cladding(
	parts: Part[],
	o: {
		at: V3;
		/** Width and height of the panel, and how thick the boards are. */
		w: number;
		h: number;
		t: number;
		colour: Hex;
		/** Board width; the panel is filled with as many as fit. */
		board?: number;
		rotY?: number;
		horizontal?: boolean;
	}
): void {
	const board = o.board ?? 0.14;
	const n = Math.max(1, Math.round((o.horizontal ? o.h : o.w) / board));
	const step = (o.horizontal ? o.h : o.w) / n;
	for (let i = 0; i < n; i++) {
		const off = -(o.horizontal ? o.h : o.w) / 2 + (i + 0.5) * step;
		const size: V3 = o.horizontal
			? [o.w, step * 0.86, o.t]
			: [step * 0.86, o.h, o.t];
		const at: V3 = o.horizontal
			? [o.at[0], o.at[1] + off, o.at[2]]
			: [o.at[0] + Math.cos(o.rotY ?? 0) * off, o.at[1], o.at[2] - Math.sin(o.rotY ?? 0) * off];
		parts.push(box(at, size, colourStep(o.colour, i), { rotY: o.rotY }));
	}
}

/** Every other board a shade off, so a clad wall is not one flat rectangle of colour. */
function colourStep(colour: Hex, i: number): Hex {
	if (i % 3 === 0) return colour;
	const n = Number.parseInt(colour.slice(1), 16);
	const d = i % 3 === 1 ? 8 : -8;
	const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + d));
	const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + d));
	const b = Math.max(0, Math.min(255, (n & 255) + d));
	const hex = (v: number): string => v.toString(16).padStart(2, '0');
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** A door you can see the parts of: leaf, frame, handle. */
function door(parts: Part[], at: V3, w: number, h: number, rotY: number, colour: Hex): void {
	const c = Math.cos(rotY);
	const sn = Math.sin(rotY);
	const along = (d: number): V3 => [at[0] + c * d, at[1], at[2] - sn * d];
	parts.push(box(at, [w, h, 0.035], colour, { rotY }));
	for (const sx of [-1, 1]) {
		parts.push(box(along(sx * (w / 2 + 0.03)), [0.06, h + 0.06, 0.05], WOOD_DARK, { rotY }));
	}
	parts.push(box([at[0], at[1] + h / 2 + 0.03, at[2]], [w + 0.12, 0.06, 0.05], WOOD_DARK, { rotY }));
	const handle = along(w * 0.32);
	parts.push(box([handle[0], at[1] - 0.02, handle[2]], [0.04, 0.04, 0.09], METAL_DARK, { rotY }));
}

/** A pane in its frame, so a window is not a floating sheet of glass. */
function window(parts: Part[], at: V3, w: number, h: number, rotY: number): void {
	const c = Math.cos(rotY);
	const sn = Math.sin(rotY);
	parts.push(box(at, [w, h, 0.02], GLASS, { rotY, opacity: 0.35 }));
	for (const sx of [-1, 1]) {
		parts.push(box([at[0] + c * sx * w * 0.5, at[1], at[2] - sn * sx * w * 0.5], [0.05, h + 0.08, 0.04], PAINT, { rotY }));
		parts.push(box([at[0], at[1] + sx * h * 0.5, at[2]], [w + 0.1, 0.05, 0.04], PAINT, { rotY }));
	}
	parts.push(box(at, [0.03, h, 0.03], PAINT, { rotY }));
}

/** Fascia along the eaves and a cap over the ridge, which is what stops a roof reading as two slabs. */
function roofTrim(
	parts: Part[],
	len: number,
	width: number,
	eave: number,
	ridge: number,
	overhang: number,
	colour: Hex
): void {
	for (const sz of [-1, 1]) {
		parts.push(box([0, eave - 0.03, (sz * (width + overhang * 2)) / 2], [len + overhang * 2, 0.11, 0.04], colour));
	}
	parts.push(box([0, ridge + 0.05, 0], [len + overhang * 2 + 0.06, 0.06, 0.14], colour));
}

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
		const cx = ux * r;
		const cz = uz * r;
		// Tangential frame about the table, so a chair faces it however many there are.
		const along = { x: Math.cos(rot), z: -Math.sin(rot) };
		const out = { x: ux, z: uz };
		const at = (o: number, s: number, y: number): V3 => [
			cx + along.x * s + out.x * o,
			y,
			cz + along.z * s + out.z * o
		];
		for (const so of [-0.17, 0.17]) {
			for (const oo of [-0.17, 0.17]) {
				parts.push(box(at(oo, so, 0.21), [0.045, 0.42, 0.045], WOOD_DARK, { rotY: rot }));
			}
		}
		for (const oo of [-0.14, 0, 0.14]) {
			parts.push(box(at(oo, 0, 0.44), [0.4, 0.035, 0.1], WOOD, { rotY: rot }));
		}
		for (const y of [0.62, 0.75, 0.88]) {
			parts.push(box(at(0.2, 0, y), [0.4, 0.09, 0.035], WOOD, { rotY: rot }));
		}
		for (const so of [-0.19, 0.19]) {
			parts.push(box(at(0.03, so, 0.63), [0.035, 0.035, 0.34], WOOD_DARK, { rotY: rot }));
			parts.push(box(at(0.19, so, 0.53), [0.035, 0.22, 0.035], WOOD_DARK, { rotY: rot }));
		}
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
		box([0, 0.34, 0.2], [0.62, 0.05, 1.3], WOOD_DARK),
		box([0, 0.4, 0.2], [0.56, 0.06, 1.24], CANVAS)
	];
	// Slats across the deck and the raised back, and arms on posts.
	for (let i = 0; i < 9; i++) {
		parts.push(box([0, 0.44, -0.38 + i * 0.14], [0.56, 0.025, 0.1], WOOD));
	}
	for (let i = 0; i < 4; i++) {
		parts.push(box([0, 0.42 + i * 0.11, -0.56 - i * 0.09], [0.56, 0.025, 0.1], WOOD, { tiltX: 0.9 }));
	}
	parts.push(box([0, 0.52, -0.7], [0.6, 0.04, 0.6], WOOD_DARK, { tiltX: 0.9 }));
	for (const sx of [-1, 1]) {
		parts.push(box([sx * 0.32, 0.56, 0.1], [0.05, 0.04, 0.9], WOOD_PALE));
		parts.push(box([sx * 0.32, 0.5, 0.5], [0.045, 0.16, 0.045], WOOD_PALE));
		for (const sz of [-1, 1]) {
			parts.push(box([sx * 0.28, 0.16, sz * 0.7], [0.05, 0.32, 0.05], WOOD_DARK));
		}
		parts.push(cyl([sx * 0.28, 0.06, -0.7], 0.12, 0.04, METAL_DARK, { rotY: Math.PI / 2, tiltX: Math.PI / 2 }));
	}
	return { parts, size: { w: 0.7, d: 1.9, h: 0.8 }, outline: rectOutline(0.7, 1.9) };
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
	// The bed hangs in a curve and gathers to a point at each end, which is the shape you know.
	const spans = 7;
	for (let i = 0; i < spans; i++) {
		const t = (i + 0.5) / spans;
		const x = -L / 2 + t * L;
		const dip = Math.sin(Math.PI * t);
		parts.push(
			box([x, sag + (1 - dip) * 0.55, 0], [L / spans + 0.02, 0.05, 0.1 + dip * 0.46], CANVAS, {
				tiltX: (0.5 - t) * 0.9
			})
		);
	}
	for (const sx of [-1, 1]) {
		for (const dz of [-0.16, 0, 0.16]) {
			parts.push(box([sx * L * 0.42, sag + 0.42, dz], [L * 0.16, 0.02, 0.02], ROPE, { tiltX: sx * 0.25 }));
		}
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
	const bowl = 0.62;
	const parts: Part[] = [
		// Bowl, lid, vent and handle: the four things that make a kettle read as a kettle.
		ball([0, 0.72, 0], [bowl, 0.34, bowl], PLASTIC),
		cyl([0, 0.78, 0], bowl, 0.06, METAL_DARK),
		ball([0, 0.86, 0], [bowl, 0.3, bowl], METAL_DARK),
		cyl([0, 1.02, 0], 0.07, 0.05, METAL),
		box([0, 1.05, 0], [0.05, 0.03, 0.14], METAL),
		box([0, 0.9, -bowl * 0.46], [0.22, 0.03, 0.03], WOOD_DARK, { tiltX: 0.5 }),
		cyl([0, 0.36, 0], 0.05, 0.18, METAL_DARK)
	];
	// Two legs and two wheels, the way one actually stands.
	for (const sx of [-1, 1]) {
		parts.push(
			box([sx * 0.24, 0.28, 0.16], [0.035, 0.58, 0.035], METAL_DARK, { tiltX: 0.12 }),
			box([sx * 0.2, 0.3, -0.2], [0.035, 0.62, 0.035], METAL_DARK, { tiltX: -0.16 })
		);
	}
	for (const sx of [-1, 1]) {
		parts.push(cyl([sx * 0.3, 0.11, -0.24], 0.22, 0.05, PLASTIC, { rotY: Math.PI / 2, tiltX: Math.PI / 2 }));
	}
	parts.push(box([0, 0.2, -0.02], [0.44, 0.03, 0.3], METAL_DARK));
	return { parts, size: { w: 0.74, d: 0.72, h: 1.08 }, outline: roundOutline(0.74) };
}

function pot(q: Q, rng: Rng): Built {
	const D = num(q, 'diameter', 0.45);
	const h = D * 0.85;
	const parts: Part[] = [
		cyl([0, h * 0.28, 0], D * 0.76, h * 0.56, TERRACOTTA),
		cyl([0, h * 0.74, 0], D, h * 0.44, TERRACOTTA),
		cyl([0, h - 0.01, 0], D * 1.06, 0.05, WOOD_PALE),
		cyl([0, h - 0.03, 0], D * 0.9, 0.04, SOIL)
	];
	crop(parts, 0, h - 0.02, 0, D * 0.9, rng);
	return { parts, size: { w: D * 1.15, d: D * 1.15, h: h + D * 0.9 }, outline: roundOutline(D) };
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
		crop(parts, x, H - 0.03, between(rng, -0.05, 0.05), between(rng, 0.2, 0.3), rng);
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
		crop(parts, x, H - 0.03, z, between(rng, 0.18, 0.26), rng);
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
	// Sown in rows across the bed, the way a kitchen garden actually is.
	const rows = Math.max(2, Math.round(L / 0.45));
	const perRow = Math.max(2, Math.round(W / 0.32));
	for (let i = 0; i < rows; i++) {
		const x = -L / 2 + ((i + 0.5) * L) / rows + between(rng, -0.02, 0.02);
		for (let k = 0; k < perRow; k++) {
			const z = -W / 2 + ((k + 0.5) * W) / perRow + between(rng, -0.02, 0.02);
			crop(parts, x, H - 0.04, z, between(rng, 0.13, 0.2), rng);
		}
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
	// Slatted sides with air gaps, which is what a compost bin is; posts at the corners.
	for (const y of [0.12, 0.32, 0.52, 0.72]) {
		for (const sz of [-1, 1]) parts.push(box([0, y, (sz * (W - 0.03)) / 2], [W, 0.15, 0.028], WOOD));
		for (const sx of [-1, 1]) {
			parts.push(box([(sx * (W - 0.03)) / 2, y, 0], [0.028, 0.15, W - 0.06], WOOD));
		}
	}
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			parts.push(box([sx * (W / 2 - 0.03), 0.42, sz * (W / 2 - 0.03)], [0.06, 0.86, 0.06], WOOD_DARK));
		}
	}
	parts.push(box([0, 0.78, 0], [W - 0.1, 0.12, W - 0.1], SOIL));
	parts.push(box([0, 0.88, 0.02], [W + 0.08, 0.035, W + 0.06], PLASTIC, { tiltX: 0.06 }));
	for (const sx of [-1, 1]) {
		parts.push(box([sx * W * 0.3, 0.9, -W / 2 + 0.03], [0.1, 0.03, 0.06], METAL_DARK));
	}
	return { parts, size: { w: W + 0.08, d: W + 0.08, h: 0.92 }, outline: rectOutline(W + 0.08, W + 0.08) };
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
	const parts: Part[] = [box([0, 0.07, 0], [L + 0.12, 0.14, W + 0.12], STONE_DARK)];

	// Boarded walls with corner posts, a door on the gable end and a window on the long side.
	cladding(parts, { at: [0, H / 2, -W / 2 + 0.02], w: L, h: H, t: 0.04, colour: FALU });
	cladding(parts, { at: [0, H / 2, W / 2 - 0.02], w: L, h: H, t: 0.04, colour: FALU });
	for (const sx of [-1, 1]) {
		cladding(parts, {
			at: [sx * (L / 2 - 0.02), H / 2, 0],
			w: W - 0.04,
			h: H,
			t: 0.04,
			colour: FALU,
			rotY: Math.PI / 2
		});
		for (const sz of [-1, 1]) {
			parts.push(box([sx * (L / 2 - 0.05), H / 2, sz * (W / 2 - 0.05)], [0.1, H, 0.1], PAINT));
		}
		parts.push(box([sx * L * 0.5, (H + ridge) / 2, 0], [0.04, ridge - H, W * 0.72], FALU));
	}
	door(parts, [L / 2 + 0.04, H * 0.45, 0], 0.85, H * 0.9, Math.PI / 2, PAINT);
	window(parts, [L * 0.22, H * 0.62, W / 2 + 0.04], 0.6, 0.5, 0);
	parts.push(box([L / 2 + 0.1, 0.02, 0], [0.5, 0.05, 1], STONE));

	gableRoof(parts, L, W, H, ridge, 0.22, WOOD_DARK);
	roofTrim(parts, L, W, H, ridge, 0.22, PAINT);
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
	const parts: Part[] = [box([0, 0.05, 0], [1.06, 0.1, 0.76], WOOD_DARK)];
	cladding(parts, { at: [0, 0.35, -0.34], w: 1, h: 0.6, t: 0.04, colour: WOOD, board: 0.1 });
	cladding(parts, { at: [0, 0.35, 0.34], w: 1, h: 0.6, t: 0.04, colour: WOOD, board: 0.1 });
	for (const sx of [-1, 1]) {
		cladding(parts, {
			at: [sx * 0.48, 0.35, 0],
			w: 0.68,
			h: 0.6,
			t: 0.04,
			colour: WOOD,
			board: 0.1,
			rotY: Math.PI / 2
		});
	}
	// The doorway is a hole, so it is cut by drawing the wall around it rather than over it.
	parts.push(box([0, 0.26, 0.36], [0.36, 0.44, 0.03], EMBER));
	for (const sx of [-1, 1]) {
		parts.push(box([sx * 0.24, 0.35, 0.37], [0.05, 0.6, 0.04], WOOD_PALE));
	}
	parts.push(box([0, 0.6, 0.37], [0.44, 0.06, 0.04], WOOD_PALE));
	gableRoof(parts, 1, 0.7, 0.65, 0.95, 0.1, FALU);
	roofTrim(parts, 1, 0.7, 0.65, 0.95, 0.1, WOOD_PALE);
	return { parts, size: { w: 1.05, d: 0.75, h: 0.95 }, outline: rectOutline(1.05, 0.75) };
}

function playhouse(q: Q): Built {
	const W = num(q, 'width', 1.6);
	const D = W * 0.9;
	const H = 1.35;
	const ridge = H + D * 0.3;
	const parts: Part[] = [box([0, 0.06, 0], [W + 0.1, 0.12, D + 0.1], WOOD_DARK)];
	cladding(parts, { at: [0, H / 2, -D / 2 + 0.02], w: W, h: H, t: 0.04, colour: FALU, board: 0.11 });
	cladding(parts, { at: [0, H / 2, D / 2 - 0.02], w: W, h: H, t: 0.04, colour: FALU, board: 0.11 });
	for (const sx of [-1, 1]) {
		cladding(parts, {
			at: [sx * (W / 2 - 0.02), H / 2, 0],
			w: D - 0.04,
			h: H,
			t: 0.04,
			colour: FALU,
			board: 0.11,
			rotY: Math.PI / 2
		});
		parts.push(box([(sx * W) / 2, (H + ridge) / 2, 0], [0.04, ridge - H, D * 0.7], FALU));
	}
	door(parts, [0, H * 0.4, D / 2 + 0.04], 0.5, H * 0.78, 0, PAINT);
	window(parts, [W / 2 + 0.04, H * 0.62, 0], 0.42, 0.4, Math.PI / 2);
	// A child's house has a flower box under the window, which is most of what makes it read as one.
	parts.push(box([W / 2 + 0.11, H * 0.4, 0], [0.12, 0.14, 0.5], WOOD_PALE));
	gableRoof(parts, W, D, H, ridge, 0.14, WOOD_DARK);
	roofTrim(parts, W, D, H, ridge, 0.14, PAINT);
	return { parts, size: { w: W, d: D, h: ridge }, outline: rectOutline(W, D) };
}

function trampoline(q: Q): Built {
	const D = num(q, 'diameter', 3);
	const parts: Part[] = [
		cyl([0, 0.8, 0], D - 0.42, 0.03, '#2f3a3d'),
		cyl([0, 0.86, 0], D, 0.16, '#4f6d7a'),
		cyl([0, 0.79, 0], D - 0.06, 0.04, METAL)
	];
	// Springs under the pad, and legs in pairs the way one actually stands.
	const springs = Math.max(12, Math.round(D * 8));
	for (let i = 0; i < springs; i++) {
		const a = (i / springs) * Math.PI * 2;
		const r = (D - 0.24) / 2;
		parts.push(box([Math.cos(a) * r, 0.79, Math.sin(a) * r], [0.18, 0.02, 0.02], METAL, { rotY: -a }));
	}
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2;
		const r = D / 2 - 0.06;
		parts.push(box([Math.cos(a) * r, 0.4, Math.sin(a) * r], [0.06, 0.8, 0.06], METAL, { rotY: -a, tiltX: 0.12 }));
		parts.push(box([Math.cos(a) * r, 0.4, Math.sin(a) * r], [0.06, 0.8, 0.06], METAL, { rotY: -a, tiltX: -0.12 }));
		parts.push(box([Math.cos(a) * r * 0.95, 0.03, Math.sin(a) * r * 0.95], [0.06, 0.05, 0.5], METAL_DARK, { rotY: -a }));
	}
	return { parts, size: { w: D, d: D, h: 0.94 }, outline: roundOutline(D) };
}

function sandpit(q: Q, rng: Rng): Built {
	const W = num(q, 'width', 1.5);
	const parts: Part[] = [box([0, 0.09, 0], [W - 0.24, 0.18, W - 0.24], SAND)];
	for (const sz of [-1, 1]) {
		cladding(parts, { at: [0, 0.14, sz * (W / 2 - 0.06)], w: W, h: 0.28, t: 0.11, colour: WOOD, horizontal: true });
	}
	for (const sx of [-1, 1]) {
		cladding(parts, {
			at: [sx * (W / 2 - 0.06), 0.14, 0],
			w: W - 0.24,
			h: 0.28,
			t: 0.11,
			colour: WOOD,
			horizontal: true,
			rotY: Math.PI / 2
		});
	}
	// Corner seats, and sand that is not perfectly level.
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			parts.push(box([sx * (W / 2 - 0.17), 0.29, sz * (W / 2 - 0.17)], [0.36, 0.05, 0.36], WOOD_PALE));
		}
	}
	for (let i = 0; i < 3; i++) {
		const s2 = between(rng, 0.2, 0.34);
		parts.push(
			ball(
				[between(rng, -W * 0.25, W * 0.25), 0.18, between(rng, -W * 0.25, W * 0.25)],
				[s2, s2 * 0.3, s2],
				SAND
			)
		);
	}
	return { parts, size: { w: W, d: W, h: 0.32 }, outline: rectOutline(W, W) };
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
		// The cross brace is what stops an A frame reading as two loose sticks.
		parts.push(box([(sx * W) / 2, H * 0.42, 0], [0.07, 0.07, H * Math.tan(splay) * 1.4], WOOD_PALE));
		parts.push(box([(sx * W) / 2, H - 0.06, 0], [0.14, 0.14, 0.2], METAL_DARK));
	}
	for (const sx of [-1, 1]) {
		const x = sx * W * 0.22;
		// One flat seat and one cradle, the way a set actually comes.
		if (sx < 0) {
			parts.push(box([x, 0.45, 0], [0.46, 0.05, 0.2], PLASTIC));
		} else {
			parts.push(box([x, 0.5, 0], [0.4, 0.06, 0.26], PLASTIC));
			for (const sz of [-1, 1]) parts.push(box([x, 0.62, sz * 0.13], [0.4, 0.2, 0.04], PLASTIC));
		}
		const seatY = sx < 0 ? 0.45 : 0.5;
		for (const dx of [-0.19, 0.19]) {
			const links = 7;
			for (let k = 0; k < links; k++) {
				const y = seatY + ((H - 0.12 - seatY) * (k + 0.5)) / links;
				parts.push(cyl([x + dx, y, 0], 0.022, (H - seatY) / links - 0.02, METAL, { tiltX: k % 2 ? 0.5 : 0 }));
			}
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
	const parts: Part[] = [box([0, H, 0], [W + 0.09, 0.09, 0.09], PAINT)];
	for (const sx of [-1, 1]) {
		parts.push(cyl([(sx * W) / 2, H / 2, 0], 0.09, H, PAINT));
		parts.push(
			box([(sx * W) / 2, H / 2, -depth / 2], [0.06, H / Math.cos(lean), 0.06], PAINT, {
				tiltX: lean
			})
		);
		parts.push(box([(sx * W) / 2, 0.03, -depth / 2], [0.06, 0.06, depth], PAINT));
	}
	// The net as cords: a grid across the back and down the sides, in its own off white.
	const NET: Hex = '#cfd3cc';
	const cords = Math.max(5, Math.round(W / 0.28));
	for (let i = 0; i < cords; i++) {
		const x = -W / 2 + ((i + 0.5) * W) / cords;
		parts.push(box([x, H / 2, -depth], [0.012, H, 0.012], NET, { opacity: 0.75 }));
	}
	const rows = Math.max(4, Math.round(H / 0.28));
	for (let i = 0; i < rows; i++) {
		const y = ((i + 0.5) * H) / rows;
		parts.push(box([0, y, -depth], [W, 0.012, 0.012], NET, { opacity: 0.75 }));
		for (const sx of [-1, 1]) {
			parts.push(box([(sx * W) / 2, y, -depth / 2], [0.012, 0.012, depth], NET, { opacity: 0.75 }));
		}
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
	// Lines strung between the arms, in rings, which is the whole point of the thing.
	for (const ring of [0.34, 0.55, 0.76, 0.94]) {
		const r = (D / 2) * ring;
		const sides = 8;
		for (let i = 0; i < sides; i++) {
			const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
			const chord = 2 * r * Math.sin(Math.PI / sides);
			parts.push(
				box([Math.cos(a) * r * Math.cos(Math.PI / sides), 1.72 - ring * 0.06, Math.sin(a) * r * Math.cos(Math.PI / sides)], [chord, 0.012, 0.012], CANVAS, {
					rotY: tangential(a)
				})
			);
		}
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
	// Galvanised hoops on a darker ground rail, with a foot plate at each end.
	const parts: Part[] = [
		box([0, 0.05, -0.3], [W, 0.05, 0.05], METAL_DARK),
		box([0, 0.05, 0.3], [W, 0.05, 0.05], METAL_DARK)
	];
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			parts.push(box([(sx * W) / 2, 0.02, sz * 0.3], [0.1, 0.03, 0.1], METAL_DARK));
		}
	}
	for (let i = 0; i < places; i++) {
		const x = -W / 2 + (i + 0.5) * 0.4;
		for (const dx of [-0.055, 0.055]) parts.push(cyl([x + dx, 0.21, 0], 0.04, 0.42, METAL));
		parts.push(box([x, 0.42, 0], [0.15, 0.04, 0.04], METAL));
	}
	return { parts, size: { w: W, d: 0.7, h: 0.42 }, outline: rectOutline(W, 0.7) };
}

function mailbox(): Built {
	const parts: Part[] = [
		box([0, 0.5, 0], [0.09, 1, 0.09], WOOD),
		box([0, 1.01, 0], [0.13, 0.03, 0.13], WOOD_DARK),
		box([0, 1.06, 0], [0.16, 0.06, 0.5], WOOD_DARK),
		box([0, 1.24, 0], [0.4, 0.3, 0.32], METAL_DARK),
		// A rounded lid, a slot, a plate for the name and a flag on its pivot.
		cyl([0, 1.39, 0], 0.4, 0.32, METAL, { rotY: Math.PI / 2, tiltX: Math.PI / 2 }),
		box([0, 1.27, 0.17], [0.26, 0.025, 0.02], PAINT),
		box([0, 1.14, 0.17], [0.22, 0.07, 0.015], PAINT),
		box([0.21, 1.3, 0], [0.02, 0.02, 0.02], METAL),
		box([0.22, 1.4, 0], [0.02, 0.18, 0.05], FALU)
	];
	return { parts, size: { w: 0.44, d: 0.5, h: 1.5 }, outline: rectOutline(0.44, 0.5) };
}

function wheelieBin(q: Q): Built {
	const n = Math.max(1, Math.round(num(q, 'count', 1)));
	const pitch = 0.66;
	const W = n * pitch;
	const parts: Part[] = [];
	for (let i = 0; i < n; i++) {
		const x = (i - (n - 1) / 2) * pitch;
		// A bin is a tapered tub with a lipped lid, a handle bar and two wheels at the back.
		parts.push(box([x, 0.3, 0.02], [0.52, 0.56, 0.64], PLASTIC));
		parts.push(box([x, 0.72, 0], [0.58, 0.32, 0.7], PLASTIC));
		parts.push(box([x, 0.93, -0.01], [0.6, 0.05, 0.72], METAL_DARK));
		parts.push(box([x, 0.97, 0.3], [0.34, 0.04, 0.06], METAL_DARK));
		parts.push(box([x, 1.02, -0.32], [0.42, 0.05, 0.05], METAL_DARK));
		for (const dx of [-0.24, 0.24]) {
			parts.push(cyl([x + dx, 0.1, -0.28], 0.2, 0.06, EMBER, { tiltX: Math.PI / 2 }));
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
		cone([0, H + 0.06, 0], 0.26, 0.12, METAL_DARK),
		ball([0, H + 0.14, 0], [0.05, 0.06, 0.05], METAL_DARK)
	];
	// Corner bars round the glass, which is what makes it a lantern and not a glowing cube.
	for (const sx of [-1, 1]) {
		for (const sz of [-1, 1]) {
			parts.push(box([sx * 0.08, H - 0.14, sz * 0.08], [0.02, 0.22, 0.02], METAL_DARK));
		}
	}
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
		box([0, 0.74, 0], [0.92, 0.04, 0.35], METAL_DARK),
		cyl([0, 0.45, 0.17], 0.46, 0.03, METAL_DARK, { tiltX: Math.PI / 2 }),
		cyl([0, 0.45, 0.19], 0.12, 0.04, PLASTIC, { tiltX: Math.PI / 2 }),
		box([-0.35, 0.055, 0], [0.1, 0.11, 0.36], METAL_DARK),
		box([0.35, 0.055, 0], [0.1, 0.11, 0.36], METAL_DARK)
	];
	// Fan guard bars across the opening, and a louvred back.
	for (let i = 0; i < 5; i++) {
		const y = 0.45 + (i - 2) * 0.09;
		parts.push(box([0, y, 0.185], [0.44, 0.015, 0.015], METAL_DARK));
	}
	for (let i = 0; i < 6; i++) {
		parts.push(box([0, 0.2 + i * 0.09, -0.17], [0.84, 0.05, 0.02], METAL_DARK, { tiltX: 0.3 }));
	}
	parts.push(cyl([0.3, 0.18, -0.2], 0.05, 0.3, METAL_DARK, { tiltX: Math.PI / 2 }));
	return { parts, size: { w: 0.92, d: 0.42, h: 0.78 }, outline: rectOutline(0.92, 0.42) };
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
		cyl([0, 0.06, 0], D * 0.72, 0.12, STONE_DARK),
		cyl([0, H * 0.32, 0], D * 0.94, H * 0.5, PLASTIC),
		cyl([0, H * 0.75, 0], D, H * 0.38, PLASTIC),
		cyl([0, H * 0.3, 0], D + 0.03, 0.035, METAL_DARK),
		cyl([0, H * 0.66, 0], D + 0.03, 0.035, METAL_DARK),
		cyl([0, H + 0.02, 0], D + 0.06, 0.05, METAL_DARK),
		// The tap, its spout and a little standpipe, which is what you recognise it by.
		box([0, 0.2, D / 2 - 0.02], [0.05, 0.05, 0.1], METAL),
		cyl([0, 0.16, D / 2 + 0.04], 0.03, 0.09, METAL),
		box([0, 0.24, D / 2 + 0.04], [0.09, 0.02, 0.02], METAL)
	];
	return { parts, size: { w: D + 0.06, d: D + 0.12, h: H + 0.05 }, outline: roundOutline(D + 0.06) };
}

function birdBath(): Built {
	const parts: Part[] = [
		cyl([0, 0.04, 0], 0.42, 0.08, STONE_DARK),
		cyl([0, 0.11, 0], 0.3, 0.08, STONE),
		cyl([0, 0.42, 0], 0.13, 0.62, STONE),
		cyl([0, 0.74, 0], 0.22, 0.06, STONE),
		cyl([0, 0.8, 0], 0.52, 0.08, STONE),
		cyl([0, 0.85, 0], 0.46, 0.03, WATER, { opacity: 0.9 })
	];
	// Flutes up the column, which is what stops it reading as a length of pipe.
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		parts.push(box([Math.cos(a) * 0.065, 0.42, Math.sin(a) * 0.065], [0.03, 0.6, 0.03], STONE_DARK, { rotY: -a }));
	}
	return { parts, size: { w: 0.52, d: 0.52, h: 0.88 }, outline: roundOutline(0.52) };
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
		ball([0, h / 2, 0], [D, h, D * between(rng, 0.82, 1)], STONE, { rotY: rng() * Math.PI })
	];
	// Lumps and a shoulder or two, so the outline is broken rather than an egg.
	const lumps = 5 + Math.floor(rng() * 3);
	for (let i = 0; i < lumps; i++) {
		const a = (i / lumps) * Math.PI * 2 + between(rng, -0.5, 0.5);
		const d = D * between(rng, 0.15, 0.34);
		const r = D * between(rng, 0.3, 0.52);
		parts.push(
			ball(
				[Math.cos(a) * d, h * between(rng, 0.2, 0.6), Math.sin(a) * d],
				[r, h * between(rng, 0.4, 0.75), r * between(rng, 0.75, 1)],
				i % 2 === 0 ? STONE : STONE_DARK,
				{ rotY: rng() * Math.PI }
			)
		);
	}
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
		// A lip round the tray keeps the seed on it, and that lip is what you recognise.
		parts.push(box([sx * 0.21, H + 0.04, 0], [0.03, 0.05, 0.44], WOOD_PALE));
		parts.push(box([0, H + 0.04, sx * 0.21], [0.44, 0.05, 0.03], WOOD_PALE));
	}
	parts.push(cyl([0, H + 0.12, 0], 0.09, 0.16, '#c8a86a'));
	parts.push(cyl([0, H + 0.21, 0], 0.11, 0.02, WOOD_DARK));
	parts.push(box([0, H + 0.06, 0], [0.3, 0.02, 0.3], '#c8a86a'));
	gableRoof(parts, 0.5, 0.5, H + 0.28, ridge, 0.06, WOOD_DARK);
	roofTrim(parts, 0.5, 0.5, H + 0.28, ridge, 0.06, WOOD_PALE);
	return { parts, size: { w: 0.52, d: 0.52, h: ridge }, outline: rectOutline(0.52, 0.52) };
}

function insectHotel(): Built {
	const parts: Part[] = [
		box([-0.2, 0.2, 0], [0.06, 0.4, 0.06], WOOD_DARK),
		box([0.2, 0.2, 0], [0.06, 0.4, 0.06], WOOD_DARK),
		box([0, 0.75, 0], [0.5, 0.72, 0.18], WOOD),
		box([0, 0.4, 0], [0.5, 0.04, 0.18], WOOD_DARK),
		box([0, 0.66, 0], [0.46, 0.03, 0.17], WOOD_DARK),
		box([0, 0.86, 0], [0.46, 0.03, 0.17], WOOD_DARK)
	];
	// Cut canes in one compartment, cones in another, drilled blocks in the third.
	for (let i = 0; i < 14; i++) {
		const x = -0.19 + (i % 7) * 0.063;
		const y = 0.5 + Math.floor(i / 7) * 0.07;
		parts.push(cyl([x, y, 0.04], 0.045, 0.14, '#c8a86a', { tiltX: Math.PI / 2 }));
	}
	for (let i = 0; i < 6; i++) {
		const x = -0.16 + (i % 3) * 0.16;
		const y = 0.72 + Math.floor(i / 3) * 0.1;
		parts.push(cone([x, y, 0.03], 0.11, 0.14, WOOD_DARK, { tiltX: -Math.PI / 2 }));
	}
	for (let i = 0; i < 8; i++) {
		const x = -0.18 + (i % 4) * 0.12;
		const y = 0.94 + Math.floor(i / 4) * 0.08;
		parts.push(cyl([x, y, 0.05], 0.03, 0.12, EMBER, { tiltX: Math.PI / 2 }));
	}
	parts.push(box([0, 1.14, 0], [0.6, 0.04, 0.28], FALU, { tiltX: 0.2 }));
	parts.push(box([0, 1.18, -0.12], [0.62, 0.05, 0.05], WOOD_DARK));
	return { parts, size: { w: 0.62, d: 0.3, h: 1.22 }, outline: rectOutline(0.52, 0.22) };
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
