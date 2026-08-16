import type { Doc, Entity, SpeciesId } from '../core/doc/types.js';
import { lineStyle, material } from '../core/doc/materials.js';
import { area as ringArea, netArea, pathLength, strokeToRing } from '../core/geom/polygon.js';
import { SPECIES } from '../core/plants/catalog.js';

export type PlantingRow = {
	species: string;
	latin: string;
	sv: string;
	count: number;
	matureH: number;
	matureW: number;
	spacing: number;
};

export type MaterialRow = { material: string; sv: string; group: string; areaM2: number };

export type EdgingRow = { style: string; sv: string; lengthM: number };

export type Takeoff = {
	plants: PlantingRow[];
	materials: MaterialRow[];
	edging: EdgingRow[];
	plotAreaM2: number;
	totalHardM2: number;
	totalSoftM2: number;
};

type SpeciesInfo = { latin: string; sv: string; matureH: number; matureW: number; spacing: number };

const CATALOG = new Map(SPECIES.map((s) => [s.id, s]));

/** A species the catalog does not know still reports its id, so the list never loses a plant. */
function speciesInfo(id: SpeciesId): SpeciesInfo {
	const s = CATALOG.get(id);
	if (!s) return { latin: id, sv: id, matureH: 0, matureW: 0, spacing: 0 };
	return { latin: s.latin, sv: s.sv, matureH: s.mature.h, matureW: s.mature.w, spacing: s.spacing };
}

/** Square metres a surface entity contributes to its material. */
function surfaceArea(e: Extract<Entity, { k: 'area' | 'path' }>): number {
	if (e.k === 'area') return e.ring.length >= 3 ? netArea(e.ring, e.holes ?? []) : 0;
	return e.spine.length >= 2 ? ringArea(strokeToRing(e.spine, e.width)) : 0;
}

/**
 * Counts every entity in the document, including those on hidden or locked
 * layers: a takeoff is an order list, not a view of what is currently drawn.
 */
export function takeoff(doc: Doc): Takeoff {
	const areas = new Map<string, number>();
	const runs = new Map<string, number>();
	const counts = new Map<string, number>();

	for (const e of doc.entities) {
		switch (e.k) {
			case 'area':
			case 'path':
				areas.set(e.mat.id, (areas.get(e.mat.id) ?? 0) + surfaceArea(e));
				break;
			case 'line':
				runs.set(e.style.id, (runs.get(e.style.id) ?? 0) + pathLength(e.spine));
				break;
			case 'plant':
				counts.set(e.species, (counts.get(e.species) ?? 0) + 1);
				break;
		}
	}

	const materials: MaterialRow[] = [...areas.entries()]
		.map(([id, areaM2]) => {
			const def = material(id);
			return { material: id, sv: def.sv, group: def.group, areaM2 };
		})
		.sort((a, b) => a.group.localeCompare(b.group, 'sv') || b.areaM2 - a.areaM2);

	const edging: EdgingRow[] = [...runs.entries()]
		.map(([id, lengthM]) => ({ style: id, sv: lineStyle(id).sv, lengthM }))
		.sort((a, b) => b.lengthM - a.lengthM);

	const plants: PlantingRow[] = [...counts.entries()]
		.map(([id, count]) => ({ species: id, count, ...speciesInfo(id) }))
		.sort((a, b) => b.count - a.count || a.sv.localeCompare(b.sv, 'sv'));

	const sumOf = (group: string): number =>
		materials.reduce((s, r) => (r.group === group ? s + r.areaM2 : s), 0);

	return {
		plants,
		materials,
		edging,
		plotAreaM2: doc.plot.boundary.length >= 3 ? ringArea(doc.plot.boundary) : 0,
		totalHardM2: sumOf('hard'),
		totalSoftM2: sumOf('soft')
	};
}

/** Swedish label for `MaterialDef.group`, which the model keeps in English. */
export const GROUP_SV: Readonly<Record<string, string>> = {
	soft: 'Mjuk yta',
	hard: 'Hårdgjort',
	water: 'Vatten',
	structure: 'Byggnad'
};

const SEP = ';';

/** Comma decimal, no thousands separator: a grouping space stops Excel parsing the cell as a number. */
function num(n: number, dp: number): string {
	return (Number.isFinite(n) ? n : 0).toFixed(dp).replace('.', ',');
}

function cell(value: string): string {
	// A leading = + @ is what turns a species name into a formula, so it gets defused.
	const safe = /^[=+@]/.test(value) ? `'${value}` : value;
	return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(rows: readonly (readonly string[])[]): string {
	return rows.map((r) => r.map(cell).join(SEP)).join('\r\n');
}

const PLANT_HEAD = ['Art', 'Latinskt namn', 'Antal', 'Höjd (m)', 'Bredd (m)', 'C/C (m)'] as const;

function plantRows(t: Takeoff): string[][] {
	return t.plants.map((p) => [
		p.sv,
		p.latin,
		String(p.count),
		num(p.matureH, 1),
		num(p.matureW, 1),
		num(p.spacing, 2)
	]);
}

/** Semicolon separated, since Swedish Excel expects that with a comma decimal. */
export function takeoffCsv(doc: Doc): string {
	const t = takeoff(doc);
	const rows: string[][] = [
		['Täppa', doc.meta.name],
		['Tomtyta (m²)', num(t.plotAreaM2, 1)],
		['Hårdgjort (m²)', num(t.totalHardM2, 1)],
		['Mjuka ytor (m²)', num(t.totalSoftM2, 1)],
		[],
		['Material', 'Grupp', 'Yta (m²)'],
		...t.materials.map((m) => [m.sv, GROUP_SV[m.group] ?? m.group, num(m.areaM2, 1)]),
		[],
		['Staket och häck', 'Löpmeter (m)'],
		...t.edging.map((e) => [e.sv, num(e.lengthM, 1)]),
		[],
		[...PLANT_HEAD],
		...plantRows(t)
	];
	return toCsv(rows);
}

export function plantingListCsv(doc: Doc): string {
	return toCsv([[...PLANT_HEAD], ...plantRows(takeoff(doc))]);
}
