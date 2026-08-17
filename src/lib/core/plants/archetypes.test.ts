import { describe, expect, it } from 'vitest';
import { SPECIES, speciesOr } from './catalog.js';
import { plantForm } from './archetypes.js';
import type { PlantForm, Season } from './types.js';

const form = (id: string, season: Season = 'summer', seed = 'seed-1'): PlantForm =>
	plantForm({ species: speciesOr(id), sizeFactor: 1, season, month: 7, seed });

describe('plantForm', () => {
	it('builds the same plant every time from one seed', () => {
		expect(form('bjork')).toEqual(form('bjork'));
		expect(form('bjork', 'summer', 'other')).not.toEqual(form('bjork'));
	});

	it('keeps every part inside the size the species says it reaches', () => {
		for (const sp of SPECIES) {
			const f = form(sp.id);
			if (f.masses.length === 0) continue;
			const reach = Math.max(sp.mature.w, sp.mature.h) * 1.35 + 0.5;
			for (const m of f.masses) {
				expect(Math.hypot(m.at.x, m.at.z) + Math.max(m.rx, m.rz)).toBeLessThan(reach);
				expect(m.at.y + m.ry).toBeLessThan(sp.mature.h * 1.35 + 0.5);
				expect(m.at.y - m.ry).toBeGreaterThan(-0.4);
			}
		}
	});

	it('hangs the foliage on branches that reach it', () => {
		const f = form('bjork');
		expect(f.limbs?.length ?? 0).toBeGreaterThan(3);
		// Every clump has a limb end within its own radius plus a little, so nothing floats free.
		for (const m of f.masses) {
			const near = (f.limbs ?? []).some(
				(l) =>
					Math.hypot(l.b.x - m.at.x, l.b.y - m.at.y, l.b.z - m.at.z) <
					Math.max(m.rx, m.ry) * 2.5 + 0.3
			);
			expect(near).toBe(true);
		}
	});

	it('shades the canopy rather than painting it one flat colour', () => {
		const shades = new Set(form('bjork').masses.map((m) => m.colour));
		expect(shades.size).toBeGreaterThan(4);
	});

	it('stays within a sane part count on the biggest species', () => {
		for (const sp of SPECIES) {
			const f = form(sp.id);
			expect(f.masses.length + (f.limbs?.length ?? 0)).toBeLessThan(120);
		}
	});

	it('gives a bare winter tree its twiggy colour and no leaves worth speaking of', () => {
		const summer = form('bjork', 'summer');
		const winter = form('bjork', 'winter');
		expect(winter.icon.bare).toBe(true);
		expect(winter.masses[0]?.colour).not.toBe(summer.masses[0]?.colour);
	});
});
