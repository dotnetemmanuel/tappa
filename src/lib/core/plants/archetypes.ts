import type { Hex, PlantEntity } from '../doc/types.js';
import type { Vec2 } from '../geom/vec2.js';
import { between, rngFor, type Rng } from '../rng.js';
import {
	ageOf,
	foliageColour,
	isBlooming,
	isFruiting,
	seasonOf,
	seasonalFactor,
	sizeFactor
} from './growth.js';
import type {
	FormArchetype,
	FormInput,
	Mass,
	PlanIcon,
	PlantForm,
	Species,
	Trunk
} from './types.js';

const TAU = Math.PI * 2;

/** The plan stock colour, so a bare canopy tints towards the paper it sits on. */
const PAPER = '#eceee2';

function parse(c: Hex): { r: number; g: number; b: number } {
	const n = Number.parseInt(c.slice(1), 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex(r: number, g: number, b: number): Hex {
	const part = (v: number): string =>
		Math.max(0, Math.min(255, Math.round(v)))
			.toString(16)
			.padStart(2, '0');
	return `#${part(r)}${part(g)}${part(b)}`;
}

function mix(a: Hex, b: Hex, t: number): Hex {
	const x = parse(a);
	const y = parse(b);
	return toHex(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t);
}

function shade(c: Hex, t: number): Hex {
	return t < 0 ? mix(c, '#000000', -t) : mix(c, '#ffffff', t);
}

/** Bare winter growth is twiggy, so it reads lighter than the trunk it hangs on. */
function twig(bark: Hex): Hex {
	return mix(bark, PAPER, 0.3);
}

type Ctx = {
	sp: Species;
	rng: Rng;
	/** Height and spread in metres at this age and season. */
	h: number;
	w: number;
	leaf: Hex;
	bark: Hex;
};

type Build = { masses: Mass[]; trunk?: Trunk };

function blob(
	kind: Mass['kind'],
	x: number,
	y: number,
	z: number,
	rx: number,
	ry: number,
	rz: number,
	colour: Hex,
	rot?: number
): Mass {
	return { kind, at: { x, y, z }, rx, ry, rz, colour, ...(rot === undefined ? {} : { rot }) };
}

function tint(c: Ctx): Hex {
	return shade(c.leaf, between(c.rng, -0.07, 0.07));
}

function clamp(x: number, lo: number, hi: number): number {
	return x < lo ? lo : x > hi ? hi : x;
}

function stemRadius(h: number): number {
	return Math.max(0.015, h * 0.012);
}

function singleTrunk(height: number, radius: number, colour: Hex): Trunk {
	return { height, radius, colour, stems: [{ x: 0, z: 0, lean: 0 }] };
}

function broadleafRound(c: Ctx): Build {
	const trunkH = clamp(c.h - c.w * 0.95, c.h * 0.18, c.h * 0.5);
	const crownH = c.h - trunkH;
	const rx = c.w / 2;
	const cy = trunkH + crownH / 2;
	const masses = [blob('ellipsoid', 0, cy, 0, rx, crownH / 2, rx * 0.96, tint(c))];
	const lumps = 3 + Math.floor(c.rng() * 3);
	for (let i = 0; i < lumps; i++) {
		const a = (i / lumps) * TAU + between(c.rng, -0.4, 0.4);
		const d = between(c.rng, 0.5, 0.72) * rx;
		const lr = between(c.rng, 0.3, 0.44) * rx;
		const ly = cy + between(c.rng, -0.3, 0.34) * (crownH / 2);
		masses.push(
			blob('ellipsoid', Math.cos(a) * d, ly, Math.sin(a) * d, lr, lr * 0.85, lr, tint(c))
		);
	}
	return { masses, trunk: singleTrunk(trunkH, stemRadius(c.h), c.bark) };
}

function broadleafSpreading(c: Ctx): Build {
	const trunkH = clamp(c.h - c.w * 0.6, c.h * 0.2, c.h * 0.45);
	const crownH = c.h - trunkH;
	const masses = [
		blob('ellipsoid', 0, trunkH + crownH * 0.45, 0, c.w * 0.34, crownH * 0.42, c.w * 0.33, tint(c))
	];
	const arms = 3 + Math.floor(c.rng() * 2);
	for (let i = 0; i < arms; i++) {
		const a = (i / arms) * TAU + between(c.rng, -0.3, 0.3);
		const d = between(c.rng, 0.24, 0.34) * c.w;
		const r = between(c.rng, 0.26, 0.34) * c.w;
		const ly = trunkH + crownH * between(c.rng, 0.3, 0.72);
		masses.push(blob('ellipsoid', Math.cos(a) * d, ly, Math.sin(a) * d, r, r * 0.72, r, tint(c)));
	}
	return { masses, trunk: singleTrunk(trunkH, stemRadius(c.h), c.bark) };
}

function columnar(c: Ctx): Build {
	const trunkH = c.h * 0.08;
	const crownH = c.h - trunkH;
	const rx = c.w / 2;
	const masses = [blob('ellipsoid', 0, trunkH + crownH / 2, 0, rx, crownH / 2, rx, tint(c))];
	for (let i = 0; i < 2; i++) {
		const a = c.rng() * TAU;
		const d = rx * between(c.rng, 0.4, 0.6);
		const r = rx * between(c.rng, 0.5, 0.7);
		const ly = trunkH + crownH * between(c.rng, 0.25, 0.75);
		masses.push(blob('ellipsoid', Math.cos(a) * d, ly, Math.sin(a) * d, r, r * 1.4, r, tint(c)));
	}
	return { masses, trunk: singleTrunk(trunkH, stemRadius(c.h) * 0.7, c.bark) };
}

function weeping(c: Ctx): Build {
	const trunkH = c.h * 0.38;
	const rx = c.w / 2;
	const domeY = c.h * 0.68;
	const masses = [blob('ellipsoid', 0, domeY, 0, rx, c.h * 0.26, rx * 0.95, tint(c))];
	const veils = 5 + Math.floor(c.rng() * 3);
	for (let i = 0; i < veils; i++) {
		const a = (i / veils) * TAU + between(c.rng, -0.25, 0.25);
		const d = rx * between(c.rng, 0.62, 0.92);
		const drop = between(c.rng, 0.18, 0.3) * c.h;
		const ly = domeY - c.h * 0.12 - drop / 2;
		masses.push(
			blob('ellipsoid', Math.cos(a) * d, ly, Math.sin(a) * d, rx * 0.2, drop / 2, rx * 0.2, tint(c))
		);
	}
	return { masses, trunk: singleTrunk(trunkH, stemRadius(c.h), c.bark) };
}

function coniferSpire(c: Ctx): Build {
	const trunkH = c.h * 0.12;
	const span = c.h - trunkH;
	const rx = c.w / 2;
	const masses: Mass[] = [];
	// Three overlapping cones read as tiers without needing a branch model.
	const tiers = 3;
	for (let i = 0; i < tiers; i++) {
		const base = trunkH + span * (i / tiers) * 0.9;
		const top = trunkH + span * Math.min(1, (i + 1.45) / tiers);
		const r = rx * (1 - i * 0.29) * between(c.rng, 0.94, 1.04);
		masses.push(blob('cone', 0, (base + top) / 2, 0, r, (top - base) / 2, r, tint(c)));
	}
	return { masses, trunk: singleTrunk(trunkH, stemRadius(c.h), c.bark) };
}

function coniferGlobe(c: Ctx): Build {
	const rx = c.w / 2;
	const masses = [blob('ellipsoid', 0, c.h * 0.48, 0, rx, c.h * 0.52, rx * 0.97, tint(c))];
	const lumps = 2 + Math.floor(c.rng() * 3);
	for (let i = 0; i < lumps; i++) {
		const a = (i / lumps) * TAU + between(c.rng, -0.5, 0.5);
		const d = rx * between(c.rng, 0.35, 0.55);
		const r = rx * between(c.rng, 0.32, 0.46);
		masses.push(
			blob(
				'ellipsoid',
				Math.cos(a) * d,
				c.h * between(c.rng, 0.35, 0.6),
				Math.sin(a) * d,
				r,
				r * 0.8,
				r,
				tint(c)
			)
		);
	}
	return { masses };
}

function multiStem(c: Ctx): Build {
	const n = 3 + Math.floor(c.rng() * 2);
	const trunkH = c.h * 0.42;
	const crownH = c.h - trunkH;
	const masses: Mass[] = [];
	const stems: Trunk['stems'] = [];
	const base = c.w * 0.06;
	for (let i = 0; i < n; i++) {
		const a = (i / n) * TAU + between(c.rng, -0.3, 0.3);
		const lean = between(c.rng, 0.1, 0.24);
		stems.push({ x: Math.cos(a) * base, z: Math.sin(a) * base, lean });
		const d = c.w * between(c.rng, 0.2, 0.32);
		const r = c.w * between(c.rng, 0.26, 0.34);
		const ly = trunkH + crownH * between(c.rng, 0.35, 0.62);
		masses.push(blob('ellipsoid', Math.cos(a) * d, ly, Math.sin(a) * d, r, r * 0.9, r, tint(c)));
	}
	return {
		masses,
		trunk: { height: trunkH, radius: stemRadius(c.h) * 0.7, colour: c.bark, stems }
	};
}

function shrubMound(c: Ctx): Build {
	const rx = c.w / 2;
	const masses = [blob('mound', 0, c.h * 0.45, 0, rx, c.h * 0.55, rx * 0.96, tint(c))];
	const lumps = 3 + Math.floor(c.rng() * 2);
	for (let i = 0; i < lumps; i++) {
		const a = (i / lumps) * TAU + between(c.rng, -0.45, 0.45);
		const d = rx * between(c.rng, 0.3, 0.5);
		const r = rx * between(c.rng, 0.4, 0.58);
		masses.push(
			blob(
				'mound',
				Math.cos(a) * d,
				c.h * between(c.rng, 0.3, 0.45),
				Math.sin(a) * d,
				r,
				c.h * 0.42,
				r,
				tint(c)
			)
		);
	}
	return { masses };
}

function hedgeRun(c: Ctx): Build {
	// One repeat unit, slightly overlong so neighbours in a run merge.
	const half = Math.max(c.sp.spacing, 0.25) * 0.53;
	const masses = [blob('cylinder', 0, c.h / 2, 0, half, c.h / 2, c.w / 2, c.leaf)];
	return { masses };
}

function perennialClump(c: Ctx): Build {
	const n = 3 + Math.floor(c.rng() * 4);
	const rx = c.w / 2;
	const masses = [blob('ellipsoid', 0, c.h * 0.5, 0, rx * 0.5, c.h * 0.5, rx * 0.5, tint(c))];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * TAU + between(c.rng, -0.4, 0.4);
		const d = rx * between(c.rng, 0.35, 0.62);
		const r = rx * between(c.rng, 0.32, 0.5);
		const hy = c.h * between(c.rng, 0.72, 1);
		masses.push(blob('ellipsoid', Math.cos(a) * d, hy / 2, Math.sin(a) * d, r, hy / 2, r, tint(c)));
	}
	return { masses };
}

function grassTuft(c: Ctx): Build {
	const rx = c.w / 2;
	const masses = [
		blob('tuft', 0, c.h * 0.12, 0, rx * 0.45, c.h * 0.14, rx * 0.45, shade(c.leaf, -0.1))
	];
	const blades = 4 + Math.floor(c.rng() * 3);
	for (let i = 0; i < blades; i++) {
		const a = (i / blades) * TAU + between(c.rng, -0.25, 0.25);
		const lean = between(c.rng, 0.3, 0.55);
		const bh = c.h * between(c.rng, 0.78, 1);
		masses.push(
			blob(
				'fan',
				Math.cos(a) * rx * lean * 0.5,
				bh * 0.55,
				Math.sin(a) * rx * lean * 0.5,
				rx * 0.9,
				bh * 0.5,
				rx * 0.18,
				tint(c),
				a
			)
		);
	}
	return { masses };
}

function groundcoverMat(c: Ctx): Build {
	const rx = c.w / 2;
	const masses = [blob('mat', 0, c.h * 0.5, 0, rx, c.h * 0.5, rx * 0.95, tint(c))];
	const patches = 2 + Math.floor(c.rng() * 3);
	for (let i = 0; i < patches; i++) {
		const a = (i / patches) * TAU + between(c.rng, -0.5, 0.5);
		const d = rx * between(c.rng, 0.25, 0.45);
		const r = rx * between(c.rng, 0.4, 0.62);
		masses.push(
			blob(
				'mat',
				Math.cos(a) * d,
				c.h * between(c.rng, 0.35, 0.5),
				Math.sin(a) * d,
				r,
				c.h * 0.4,
				r,
				tint(c)
			)
		);
	}
	return { masses };
}

function climberOnSupport(c: Ctx): Build {
	const lean = c.rng() * TAU;
	const rx = c.w / 2;
	const off = rx * 0.28;
	const masses: Mass[] = [];
	const panels = 3;
	for (let i = 0; i < panels; i++) {
		const t = (i + 0.5) / panels;
		const ly = c.h * (0.22 + t * 0.7);
		const r = rx * between(c.rng, 0.8, 1);
		masses.push(
			blob(
				'ellipsoid',
				Math.cos(lean) * off,
				ly,
				Math.sin(lean) * off,
				r,
				c.h * 0.22,
				r * 0.5,
				tint(c),
				lean
			)
		);
	}
	return { masses, trunk: singleTrunk(c.h * 0.18, Math.max(0.012, c.h * 0.006), c.bark) };
}

function bulbCluster(c: Ctx): Build {
	const n = 5 + Math.floor(c.rng() * 5);
	const spread = Math.max(c.w, 0.08) * 1.1;
	const masses: Mass[] = [];
	for (let i = 0; i < n; i++) {
		const a = c.rng() * TAU;
		const d = spread * Math.sqrt(c.rng()) * 0.6;
		const hy = c.h * between(c.rng, 0.75, 1);
		const r = Math.max(0.01, c.w * 0.18);
		masses.push(blob('ellipsoid', Math.cos(a) * d, hy / 2, Math.sin(a) * d, r, hy / 2, r, tint(c)));
	}
	return { masses };
}

const BUILDERS: Record<FormArchetype, (c: Ctx) => Build> = {
	'broadleaf-round': broadleafRound,
	'broadleaf-spreading': broadleafSpreading,
	columnar,
	weeping,
	'conifer-spire': coniferSpire,
	'conifer-globe': coniferGlobe,
	'multi-stem': multiStem,
	'shrub-mound': shrubMound,
	'hedge-run': hedgeRun,
	'perennial-clump': perennialClump,
	'grass-tuft': grassTuft,
	'groundcover-mat': groundcoverMat,
	'climber-on-support': climberOnSupport,
	'bulb-cluster': bulbCluster
};

/** Plan uses x east and y north, so a mass maps its own x and z straight through. */
function planCircles(masses: readonly Mass[]): { x: number; y: number; r: number }[] {
	return masses.map((m) => ({ x: m.at.x, y: m.at.z, r: Math.max(m.rx, m.rz) }));
}

function canopyOutline(masses: readonly Mass[], rng: Rng): Vec2[] {
	const circles = planCircles(masses);
	if (circles.length === 0) return [];
	let widest = 0;
	for (const c of circles) if (c.r > widest) widest = c.r;
	const wide = circles.filter((c) => c.r >= widest * 0.6);
	const n = 16 + Math.floor(rng() * 9);
	const a1 = between(rng, 0.03, 0.09);
	const a2 = between(rng, 0.02, 0.06);
	const p1 = rng() * TAU;
	const p2 = rng() * TAU;
	const k1 = 2 + Math.floor(rng() * 2);
	const k2 = 5 + Math.floor(rng() * 3);
	const pts: Vec2[] = [];
	for (let i = 0; i < n; i++) {
		const th = (i / n) * TAU;
		const dx = Math.cos(th);
		const dy = Math.sin(th);
		let support = 0;
		for (const c of wide) {
			const d = c.x * dx + c.y * dy + c.r;
			if (d > support) support = d;
		}
		const wobble = 1 + a1 * Math.sin(k1 * th + p1) + a2 * Math.sin(k2 * th + p2);
		const r = Math.max(0.01, support * wobble);
		pts.push({ x: r * dx, y: r * dy });
	}
	return pts;
}

function accentOf(sp: Species, month: number): { colour: Hex; size: number } | undefined {
	if (sp.bloom && isBlooming(sp, month)) return { colour: sp.bloom.colour, size: sp.bloom.size };
	if (sp.fruit && isFruiting(sp, month)) return { colour: sp.fruit.colour, size: 0.035 };
	return undefined;
}

function iconOf(
	masses: readonly Mass[],
	rng: Rng,
	fill: Hex,
	trunkR: number,
	bare: boolean
): PlanIcon {
	return {
		outline: canopyOutline(masses, rng),
		fill,
		stroke: shade(fill, -0.32),
		trunkR,
		bare
	};
}

export function plantForm(input: FormInput): PlantForm {
	const sp = input.species;
	const rng = rngFor(input.seed);
	const bare = !sp.evergreen && input.season === 'winter';
	const leafNow = foliageColour(sp, input.season);
	const leaf = leafNow ?? twig(sp.bark);
	const planFill = bare ? mix(sp.bark, PAPER, 0.55) : leaf;
	// Per plant jitter belongs in sizeFactor, so instancing can scale one canonical form.
	const grown = clamp(input.sizeFactor, 0, 1.5) * seasonalFactor(sp, input.season);
	const h = sp.mature.h * grown;
	const w = sp.mature.w * grown;
	if (h < 0.005 || w < 0.005) {
		return {
			masses: [],
			canopyR: 0,
			height: 0,
			icon: { outline: [], fill: planFill, stroke: shade(planFill, -0.32), trunkR: 0, bare }
		};
	}

	const ctx: Ctx = { sp, rng, h, w, leaf, bark: sp.bark };
	const built = BUILDERS[sp.form](ctx);
	let canopyR = 0;
	let height = built.trunk ? built.trunk.height : 0;
	for (const m of built.masses) {
		const r = Math.hypot(m.at.x, m.at.z) + Math.max(m.rx, m.rz);
		if (r > canopyR) canopyR = r;
		const top = m.at.y + m.ry;
		if (top > height) height = top;
	}
	const trunkR = built.trunk ? Math.max(0.03, built.trunk.radius * 1.6) : 0;
	const accent = accentOf(sp, input.month);
	return {
		masses: built.masses,
		...(built.trunk ? { trunk: built.trunk } : {}),
		canopyR,
		height,
		icon: iconOf(built.masses, rng, planFill, trunkR, bare),
		...(accent ? { accent } : {})
	};
}

export function planIcon(input: FormInput): PlanIcon {
	return plantForm(input).icon;
}

export function formFor(
	sp: Species,
	plant: PlantEntity,
	globalYears: number,
	month: number
): PlantForm {
	return plantForm({
		species: sp,
		sizeFactor: sizeFactor(sp, ageOf(plant, globalYears)) * (1 + plant.sizeJitter),
		season: seasonOf(month),
		month,
		seed: plant.id
	});
}
