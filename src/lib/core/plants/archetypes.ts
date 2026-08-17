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
	Limb,
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

type Build = { masses: Mass[]; trunk?: Trunk; limbs?: Limb[] };

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


type Xyz = { x: number; y: number; z: number };

/**
 * A crown grown on a skeleton: limbs leave the trunk at staggered heights and angles, split
 * once or twice, and every tip carries a handful of small clumps. The broken outline and the
 * gaps between clumps are what stop a tree reading as a ball on a stick.
 */
function crown(
	c: Ctx,
	o: {
		/** Where the trunk ends and the crown starts. */
		base: number;
		/** Crown height and half spread, in metres. */
		height: number;
		spread: number;
		/** How far the tips lean out, 0 upright to 1 flat. */
		reach?: number;
		/** Roughly how many clumps, scaled down on a small plant. */
		density?: number;
		/** Clump radius as a share of the spread. */
		clump?: number;
		/** Pulls the crown's mass down the tips, for a weeping form. */
		droop?: number;
	}
): { masses: Mass[]; limbs: Limb[] } {
	const masses: Mass[] = [];
	const limbs: Limb[] = [];
	const reach = o.reach ?? 0.62;
	const clumpR = Math.max(0.09, o.spread * (o.clump ?? 0.34));
	const wanted = Math.round((o.density ?? 14) * clamp(o.spread / 1.6, 0.35, 1.6));
	const arms = clamp(Math.round(wanted / 3), 2, 6);
	const top: Xyz = { x: 0, y: o.base, z: 0 };

	for (let i = 0; i < arms; i++) {
		const a = (i / arms) * TAU + between(c.rng, -0.35, 0.35);
		const from: Xyz = {
			x: 0,
			y: o.base - o.height * between(c.rng, 0, 0.22),
			z: 0
		};
		const len = o.height * between(c.rng, 0.45, 0.78);
		const out = o.spread * reach * between(c.rng, 0.55, 1);
		const tip: Xyz = {
			x: Math.cos(a) * out,
			y: from.y + len,
			z: Math.sin(a) * out
		};
		const r = stemRadius(c.h) * between(c.rng, 0.5, 0.75);
		limbs.push({ a: from, b: tip, ra: r * 1.6, rb: r * 0.7, colour: c.bark });

		const twigs = 2 + Math.floor(c.rng() * 2);
		for (let k = 0; k < twigs; k++) {
			const ta = a + between(c.rng, -0.9, 0.9);
			const tout = out + o.spread * between(c.rng, 0.1, 0.34);
			const drop = (o.droop ?? 0) * o.height * between(c.rng, 0.2, 0.7);
			const end: Xyz = {
				x: Math.cos(ta) * tout,
				y: tip.y + o.height * between(c.rng, -0.05, 0.28) - drop,
				z: Math.sin(ta) * tout
			};
			limbs.push({ a: tip, b: end, ra: r * 0.7, rb: r * 0.35, colour: c.bark });
			const perTip = 1 + Math.floor(c.rng() * 2);
			for (let m = 0; m < perTip; m++) {
				const rr = clumpR * between(c.rng, 0.7, 1.15);
				masses.push(
					blob(
						'ellipsoid',
						end.x + between(c.rng, -0.4, 0.4) * clumpR,
						end.y + between(c.rng, -0.35, 0.5) * clumpR,
						end.z + between(c.rng, -0.4, 0.4) * clumpR,
						rr,
						rr * between(c.rng, 0.72, 0.95),
						rr,
						lit(c, (end.y - o.base) / Math.max(0.2, o.height))
					)
				);
			}
		}
	}

	// A little mass over the middle, or the crown reads as a ring seen from above.
	const inner = Math.max(1, Math.round(arms / 2));
	for (let i = 0; i < inner; i++) {
		const rr = clumpR * between(c.rng, 0.8, 1.2);
		const a = c.rng() * TAU;
		const d = o.spread * between(c.rng, 0, 0.3);
		masses.push(
			blob(
				'ellipsoid',
				Math.cos(a) * d,
				o.base + o.height * between(c.rng, 0.35, 0.8),
				Math.sin(a) * d,
				rr,
				rr * 0.85,
				rr,
				lit(c, between(c.rng, 0.4, 0.9))
			)
		);
	}
	void top;
	return { masses, limbs };
}

/** Foliage catches the light on top and sits in its own shade underneath. */
function lit(c: Ctx, t: number): Hex {
	return shade(c.leaf, (clamp(t, 0, 1) - 0.45) * 0.26 + between(c.rng, -0.05, 0.05));
}

/** A trunk that tapers, which is most of the difference between a tree and a pole. */
function trunkLimb(c: Ctx, height: number, radius: number, lean = 0): Limb {
	return {
		a: { x: 0, y: 0, z: 0 },
		b: { x: Math.sin(lean) * height * 0.12, y: height, z: 0 },
		ra: radius * 1.25,
		rb: radius * 0.8,
		colour: c.bark
	};
}

function broadleafRound(c: Ctx): Build {
	const trunkH = clamp(c.h - c.w * 0.95, c.h * 0.18, c.h * 0.5);
	const r = stemRadius(c.h);
	const built = crown(c, {
		base: trunkH,
		height: c.h - trunkH,
		spread: c.w / 2,
		reach: 0.6,
		density: 16
	});
	return {
		masses: built.masses,
		limbs: [trunkLimb(c, trunkH, r), ...built.limbs],
		trunk: singleTrunk(trunkH, r, c.bark)
	};
}

function broadleafSpreading(c: Ctx): Build {
	const trunkH = clamp(c.h - c.w * 0.6, c.h * 0.2, c.h * 0.45);
	const r = stemRadius(c.h);
	const built = crown(c, {
		base: trunkH,
		height: c.h - trunkH,
		spread: c.w / 2,
		reach: 0.85,
		density: 18,
		clump: 0.3
	});
	return {
		masses: built.masses,
		limbs: [trunkLimb(c, trunkH, r), ...built.limbs],
		trunk: singleTrunk(trunkH, r, c.bark)
	};
}

function columnar(c: Ctx): Build {
	const trunkH = c.h * 0.08;
	const crownH = c.h - trunkH;
	const rx = c.w / 2;
	const r = stemRadius(c.h) * 0.7;
	const masses: Mass[] = [];
	const limbs: Limb[] = [
		{ a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: c.h * 0.86, z: 0 }, ra: r * 1.3, rb: r * 0.4, colour: c.bark }
	];
	// A column is a tall spindle of clumps around one stem, not one stretched ball.
	const rows = clamp(Math.round(crownH / Math.max(0.35, rx * 0.9)), 3, 9);
	for (let i = 0; i < rows; i++) {
		const t = (i + 0.5) / rows;
		const ring = 2 + Math.floor(c.rng() * 2);
		const rowR = rx * (0.55 + 0.45 * Math.sin(Math.PI * clamp(t * 1.05, 0, 1)));
		for (let k = 0; k < ring; k++) {
			const a = (k / ring) * TAU + i * 1.1 + between(c.rng, -0.3, 0.3);
			const rr = rowR * between(c.rng, 0.5, 0.75);
			masses.push(
				blob(
					'ellipsoid',
					Math.cos(a) * rowR * 0.5,
					trunkH + crownH * t,
					Math.sin(a) * rowR * 0.5,
					rr,
					rr * 1.15,
					rr,
					lit(c, t)
				)
			);
		}
	}
	return { masses, limbs, trunk: singleTrunk(trunkH, r, c.bark) };
}

function weeping(c: Ctx): Build {
	const trunkH = c.h * 0.42;
	const r = stemRadius(c.h);
	const built = crown(c, {
		base: trunkH,
		height: c.h - trunkH,
		spread: c.w / 2,
		reach: 0.9,
		density: 16,
		clump: 0.26,
		droop: 0.55
	});
	// Curtains of growth hanging off the outer tips, which is what a weeping habit is.
	const veils = 5 + Math.floor(c.rng() * 3);
	const rx = c.w / 2;
	for (let i = 0; i < veils; i++) {
		const a = (i / veils) * TAU + between(c.rng, -0.25, 0.25);
		const d = rx * between(c.rng, 0.6, 0.95);
		const drop = between(c.rng, 0.2, 0.34) * c.h;
		const ly = c.h * 0.7 - drop / 2;
		built.masses.push(
			blob('ellipsoid', Math.cos(a) * d, ly, Math.sin(a) * d, rx * 0.14, drop / 2, rx * 0.14, lit(c, 0.3))
		);
	}
	return {
		masses: built.masses,
		limbs: [trunkLimb(c, trunkH, r), ...built.limbs],
		trunk: singleTrunk(trunkH, r, c.bark)
	};
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
	const limbs: Limb[] = [];
	const stems: Trunk['stems'] = [];
	const base = c.w * 0.06;
	const r = stemRadius(c.h) * 0.7;
	for (let i = 0; i < n; i++) {
		const a = (i / n) * TAU + between(c.rng, -0.3, 0.3);
		const lean = between(c.rng, 0.1, 0.24);
		stems.push({ x: Math.cos(a) * base, z: Math.sin(a) * base, lean });
		// Each stem leans out and carries its own share of the crown, which is the habit.
		const out = c.w * between(c.rng, 0.16, 0.28);
		const tip = {
			x: Math.cos(a) * out,
			y: trunkH + crownH * between(c.rng, 0.1, 0.3),
			z: Math.sin(a) * out
		};
		limbs.push({
			a: { x: Math.cos(a) * base, y: 0, z: Math.sin(a) * base },
			b: tip,
			ra: r * 1.2,
			rb: r * 0.6,
			colour: c.bark
		});
		const part = crown(c, {
			base: tip.y,
			height: crownH * 0.8,
			spread: (c.w / 2) * 0.55,
			reach: 0.8,
			density: 8,
			clump: 0.4
		});
		for (const m of part.masses) {
			masses.push({ ...m, at: { x: m.at.x + tip.x, y: m.at.y, z: m.at.z + tip.z } });
		}
		for (const l of part.limbs) {
			limbs.push({
				...l,
				a: { x: l.a.x + tip.x, y: l.a.y, z: l.a.z + tip.z },
				b: { x: l.b.x + tip.x, y: l.b.y, z: l.b.z + tip.z }
			});
		}
	}
	return { masses, limbs, trunk: { height: trunkH, radius: r, colour: c.bark, stems } };
}

function shrubMound(c: Ctx): Build {
	const rx = c.w / 2;
	const masses: Mass[] = [];
	const limbs: Limb[] = [];
	// Many short stems from the base, each carrying a few clumps: low, dense, no single ball.
	const stems = 4 + Math.floor(c.rng() * 4);
	const r = Math.max(0.008, c.h * 0.02);
	for (let i = 0; i < stems; i++) {
		const a = (i / stems) * TAU + between(c.rng, -0.4, 0.4);
		const out = rx * between(c.rng, 0.25, 0.62);
		const top = c.h * between(c.rng, 0.55, 0.95);
		const tip = { x: Math.cos(a) * out, y: top, z: Math.sin(a) * out };
		limbs.push({ a: { x: 0, y: 0, z: 0 }, b: tip, ra: r, rb: r * 0.5, colour: c.bark });
		const clumps = 2 + Math.floor(c.rng() * 2);
		for (let k = 0; k < clumps; k++) {
			const rr = rx * between(c.rng, 0.24, 0.4);
			masses.push(
				blob(
					'ellipsoid',
					tip.x + between(c.rng, -0.5, 0.5) * rr,
					Math.max(rr * 0.6, tip.y + between(c.rng, -0.5, 0.25) * rr),
					tip.z + between(c.rng, -0.5, 0.5) * rr,
					rr,
					rr * between(c.rng, 0.65, 0.85),
					rr,
					lit(c, tip.y / Math.max(0.2, c.h))
				)
			);
		}
	}
	return { masses, limbs };
}

function hedgeRun(c: Ctx): Build {
	// One repeat unit, slightly overlong so neighbours in a run merge.
	const half = Math.max(c.sp.spacing, 0.25) * 0.53;
	const masses = [blob('cylinder', 0, c.h / 2, 0, half, c.h / 2, c.w / 2, c.leaf)];
	return { masses };
}

function perennialClump(c: Ctx): Build {
	const rx = c.w / 2;
	const masses: Mass[] = [];
	const limbs: Limb[] = [];
	// A crown of leaves at the base and flower stems standing out of it.
	const leaves = 5 + Math.floor(c.rng() * 4);
	for (let i = 0; i < leaves; i++) {
		const a = (i / leaves) * TAU + between(c.rng, -0.3, 0.3);
		const d = rx * between(c.rng, 0.2, 0.55);
		const r = rx * between(c.rng, 0.3, 0.46);
		masses.push(
			blob(
				'ellipsoid',
				Math.cos(a) * d,
				c.h * between(c.rng, 0.22, 0.4),
				Math.sin(a) * d,
				r,
				c.h * between(c.rng, 0.22, 0.34),
				r,
				lit(c, 0.35)
			)
		);
	}
	const stems = 3 + Math.floor(c.rng() * 3);
	for (let i = 0; i < stems; i++) {
		const a = c.rng() * TAU;
		const d = rx * between(c.rng, 0.1, 0.4);
		const top = c.h * between(c.rng, 0.8, 1);
		const tip = { x: Math.cos(a) * d, y: top, z: Math.sin(a) * d };
		limbs.push({
			a: { x: tip.x * 0.4, y: c.h * 0.15, z: tip.z * 0.4 },
			b: tip,
			ra: Math.max(0.006, c.h * 0.012),
			rb: Math.max(0.004, c.h * 0.008),
			colour: shade(c.leaf, -0.28)
		});
		const rr = rx * between(c.rng, 0.14, 0.22);
		masses.push(blob('ellipsoid', tip.x, tip.y, tip.z, rr, rr * 0.8, rr, lit(c, 0.9)));
	}
	return { masses, limbs };
}

function grassTuft(c: Ctx): Build {
	const rx = c.w / 2;
	const masses = [
		blob('tuft', 0, c.h * 0.1, 0, rx * 0.42, c.h * 0.12, rx * 0.42, shade(c.leaf, -0.14))
	];
	const limbs: Limb[] = [];
	// Real blades leaning out of the crown, rather than a few flat cards.
	const blades = 10 + Math.floor(c.rng() * 8);
	for (let i = 0; i < blades; i++) {
		const a = (i / blades) * TAU + between(c.rng, -0.3, 0.3);
		const lean = between(c.rng, 0.25, 0.7);
		const bh = c.h * between(c.rng, 0.65, 1.05);
		limbs.push({
			a: { x: 0, y: c.h * 0.05, z: 0 },
			b: { x: Math.cos(a) * rx * lean, y: bh, z: Math.sin(a) * rx * lean },
			ra: Math.max(0.005, c.h * 0.022),
			rb: 0.001,
			colour: shade(c.leaf, between(c.rng, -0.12, 0.12))
		});
	}
	return { masses, limbs };
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
	for (const l of built.limbs ?? []) height = Math.max(height, l.a.y, l.b.y);
	return {
		masses: built.masses,
		...(built.trunk ? { trunk: built.trunk } : {}),
		...(built.limbs && built.limbs.length > 0 ? { limbs: built.limbs } : {}),
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
