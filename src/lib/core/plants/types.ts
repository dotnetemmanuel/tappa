import type { Hex, SpeciesId } from '../doc/types.js';
import type { Vec2 } from '../geom/vec2.js';

export type PlantCat =
	| 'tree'
	| 'shrub'
	| 'conifer'
	| 'hedge'
	| 'perennial'
	| 'grass'
	| 'fern'
	| 'bulb'
	| 'climber'
	| 'groundcover'
	| 'edible';

export type FormArchetype =
	| 'broadleaf-round'
	| 'broadleaf-spreading'
	| 'columnar'
	| 'weeping'
	| 'conifer-spire'
	| 'conifer-globe'
	| 'multi-stem'
	| 'shrub-mound'
	| 'hedge-run'
	| 'perennial-clump'
	| 'grass-tuft'
	| 'groundcover-mat'
	| 'climber-on-support'
	| 'bulb-cluster';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export type Species = {
	id: SpeciesId;
	latin: string;
	sv: string;
	en: string;
	cat: PlantCat;
	form: FormArchetype;
	/** Size at maturity, in metres. */
	mature: { h: number; w: number };
	/** Years to reach roughly two thirds of mature size. Bigger is slower. */
	growthRate: number;
	evergreen: boolean;
	foliage: { spring: Hex; summer: Hex; autumn: Hex; winter: Hex | null };
	bark: Hex;
	bloom?: { colour: Hex; months: number[]; size: number };
	fruit?: { colour: Hex; months: number[] };
	needs: { sun: 'full' | 'part' | 'shade'; moisture: 'dry' | 'normal' | 'moist'; zone: number };
	/** Recommended centre to centre spacing, in metres. */
	spacing: number;
};

/**
 * One blob of a plant, in metres, relative to the plant's own base at the
 * origin. Both renderers read this: 3D turns it into geometry, the plan turns
 * the widest ones into the canopy outline.
 */
export type Mass = {
	kind: 'ellipsoid' | 'cone' | 'cylinder' | 'mound' | 'tuft' | 'mat' | 'spire' | 'fan';
	/** Centre of the blob, y is height above ground. */
	at: { x: number; y: number; z: number };
	rx: number;
	ry: number;
	rz: number;
	colour: Hex;
	/** Rotation about the vertical axis, radians. */
	rot?: number;
};

export type Trunk = {
	height: number;
	radius: number;
	colour: Hex;
	/** More than one for a multi-stem, each offset from centre. */
	stems: { x: number; z: number; lean: number }[];
};

/**
 * One length of woody growth, from `a` to `b`, tapering from `ra` to `rb`. A trunk and the
 * branches that leave it are the same thing, which is what lets the foliage hang off tips
 * rather than float in a ball.
 */
export type Limb = {
	a: { x: number; y: number; z: number };
	b: { x: number; y: number; z: number };
	ra: number;
	rb: number;
	colour: Hex;
};

/** The plan symbol, drawn from the same parameters that build the 3D form. */
export type PlanIcon = {
	/** Canopy outline in plan metres, centred on the plant. */
	outline: Vec2[];
	fill: Hex;
	stroke: Hex;
	/** Trunk dot radius in metres, zero when there is no visible stem. */
	trunkR: number;
	/** Drawn as a dashed circle when the plant is bare. */
	bare: boolean;
};

export type PlantForm = {
	masses: Mass[];
	trunk?: Trunk;
	/** Trunk and branches as tapered lengths. Present instead of `trunk` on anything woody. */
	limbs?: Limb[];
	/** Overall canopy radius and height at this age, in metres. */
	canopyR: number;
	height: number;
	icon: PlanIcon;
	/** Set when the plant is flowering or fruiting in the current season. */
	accent?: { colour: Hex; size: number };
};

export type FormInput = {
	species: Species;
	/** 0 to 1, how far towards mature size this plant has grown. */
	sizeFactor: number;
	season: Season;
	/** Month 1 to 12, for bloom and fruit. */
	month: number;
	seed: string;
};
