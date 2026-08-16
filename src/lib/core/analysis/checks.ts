import type { Doc, EntityId, PlantEntity } from '../doc/types.js';
import { dist, type Vec2 } from '../geom/vec2.js';
import { speciesOr } from '../plants/catalog.js';
import { sizeAt } from '../plants/growth.js';
import { hoursAt, type ShadowGrid } from '../sun/shadow.js';

export type CheckKind = 'spacing' | 'sun' | 'zone';

export type Check = {
	entity: EntityId;
	kind: CheckKind;
	at: Vec2;
	/** Plan radius the warning ring is drawn at, in metres. */
	radius: number;
	message: string;
	/** The other plant involved, for a spacing clash. */
	other?: EntityId;
};

export type CheckOptions = {
	years: number;
	month: number;
	shadow?: ShadowGrid | null;
	/** Hardiness zone of the garden. Plants rated softer than this are flagged. */
	zone?: number;
	/** How much canopy overlap is tolerated before it counts, 0 to 1. */
	tolerance?: number;
};

const SUN_NEEDS: Record<'full' | 'part' | 'shade', { min: number; max: number; sv: string }> = {
	full: { min: 5, max: 24, sv: 'full sol' },
	part: { min: 2.5, max: 7, sv: 'halvskugga' },
	shade: { min: 0, max: 4.5, sv: 'skugga' }
};

/**
 * Quiet plan overlays, not modal nags: a plant whose canopy has grown into its
 * neighbour, or one standing somewhere its light needs are not met.
 */
export function runChecks(doc: Doc, o: CheckOptions): Check[] {
	const tolerance = o.tolerance ?? 0.15;
	const out: Check[] = [];
	const plants = doc.entities.filter((e): e is PlantEntity => e.k === 'plant');

	const sized = plants.map((p) => {
		const sp = speciesOr(p.species);
		const age = Math.max(0, o.years - (p.plantedYear ?? 0));
		const size = sizeAt(sp, age, p.sizeJitter);
		return { p, sp, r: size.w / 2 };
	});

	for (let i = 0; i < sized.length; i++) {
		for (let j = i + 1; j < sized.length; j++) {
			const a = sized[i];
			const b = sized[j];
			if (a.r <= 0.05 || b.r <= 0.05) continue;
			const gap = dist(a.p.at, b.p.at);
			const touching = a.r + b.r;
			const overlap = touching - gap;
			if (overlap <= touching * tolerance) continue;
			out.push({
				entity: a.p.id,
				other: b.p.id,
				kind: 'spacing',
				at: a.p.at,
				radius: a.r,
				message: `${a.sp.sv} växer ihop med ${b.sp.sv}, ${fmt(overlap)} m för tätt`
			});
		}
	}

	if (o.shadow) {
		for (const { p, sp, r } of sized) {
			if (r <= 0.05) continue;
			const hours = hoursAt(o.shadow, p.at);
			if (hours === null) continue;
			const need = SUN_NEEDS[sp.needs.sun];
			if (hours < need.min) {
				out.push({
					entity: p.id,
					kind: 'sun',
					at: p.at,
					radius: r,
					message: `${sp.sv} vill ha ${need.sv}, får ${fmt(hours)} h`
				});
			} else if (hours > need.max) {
				out.push({
					entity: p.id,
					kind: 'sun',
					at: p.at,
					radius: r,
					message: `${sp.sv} vill ha ${need.sv}, står i ${fmt(hours)} h sol`
				});
			}
		}
	}

	if (o.zone !== undefined) {
		for (const { p, sp, r } of sized) {
			if (sp.needs.zone >= o.zone) continue;
			out.push({
				entity: p.id,
				kind: 'zone',
				at: p.at,
				radius: Math.max(0.4, r),
				message: `${sp.sv} klarar zon ${sp.needs.zone}, trädgården är zon ${o.zone}`
			});
		}
	}

	return out;
}

const fmt = (n: number): string => n.toFixed(1).replace('.', ',');

export function checksFor(checks: readonly Check[], id: EntityId): Check[] {
	return checks.filter((c) => c.entity === id || c.other === id);
}
