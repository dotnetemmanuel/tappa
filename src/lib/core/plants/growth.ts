import type { Hex, PlantEntity } from '../doc/types.js';
import type { FormArchetype, Season, Species } from './types.js';

/** Forms that die back to the ground, as opposed to keeping a woody frame. */
const HERBACEOUS: ReadonlySet<FormArchetype> = new Set<FormArchetype>([
	'perennial-clump',
	'grass-tuft',
	'groundcover-mat',
	'bulb-cluster'
]);

export function isHerbaceous(sp: Species): boolean {
	return HERBACEOUS.has(sp.form);
}

/** Nursery stock is not a seedling, so a freshly planted plant already reads. */
const START_WOODY = 0.12;
const START_HERB = 0.35;

/** `growthRate` is the year at which the curve passes two thirds, so k = ln 3 / rate. */
const LN3 = Math.log(3);

export function sizeFactor(sp: Species, yearsPlanted: number): number {
	if (yearsPlanted < 0) return 0;
	const start = isHerbaceous(sp) ? START_HERB : START_WOODY;
	const rate = sp.growthRate > 0 ? sp.growthRate : 1;
	const grown = 1 - Math.exp((-LN3 * yearsPlanted) / rate);
	return Math.min(1, start + (1 - start) * grown);
}

export function sizeAt(
	sp: Species,
	yearsPlanted: number,
	jitter: number
): { h: number; w: number } {
	const f = sizeFactor(sp, yearsPlanted);
	if (f <= 0) return { h: 0, w: 0 };
	// Jitter is a direct fraction, the same reading the plan painter and sun study use.
	const scale = Math.min(1.5, Math.max(0.5, 1 + (Number.isFinite(jitter) ? jitter : 0)));
	return { h: sp.mature.h * f * scale, w: sp.mature.w * f * scale };
}

export function seasonalFactor(sp: Species, season: Season): number {
	if (!isHerbaceous(sp)) {
		if (sp.evergreen) return 1;
		// A bare crown reads a little tighter than a leafy one.
		return season === 'winter' ? 0.9 : season === 'spring' ? 0.95 : 1;
	}
	if (sp.form === 'bulb-cluster') {
		// Bulbs are up early and gone by midsummer.
		if (season === 'spring') return 1;
		if (season === 'summer') return 0.2;
		return 0;
	}
	if (sp.evergreen) {
		if (season === 'winter') return 0.6;
		return season === 'spring' ? 0.8 : 1;
	}
	if (season === 'winter') return 0;
	if (season === 'spring') return 0.5;
	return season === 'autumn' ? 0.85 : 1;
}

/** Swedish garden seasons: a short spring, a long winter, autumn over by November. */
export function seasonOf(month: number): Season {
	const m = Math.min(12, Math.max(1, Math.round(month)));
	if (m === 4 || m === 5) return 'spring';
	if (m >= 6 && m <= 8) return 'summer';
	if (m === 9 || m === 10) return 'autumn';
	return 'winter';
}

export function foliageColour(sp: Species, season: Season): Hex | null {
	if (season === 'winter') return sp.foliage.winter;
	return sp.foliage[season];
}

export function isBlooming(sp: Species, month: number): boolean {
	return sp.bloom?.months.includes(month) ?? false;
}

export function isFruiting(sp: Species, month: number): boolean {
	return sp.fruit?.months.includes(month) ?? false;
}

/** Negative when the plant is planted later than the year being shown. */
export function ageOf(plant: PlantEntity, globalYears: number): number {
	return globalYears - plant.plantedYear;
}
