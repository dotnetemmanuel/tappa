import { describe, expect, it } from 'vitest';
import { PROPS } from './catalog.js';
import { formForProp } from './builders.js';
import type { PropEntity } from '../doc/types.js';

const entity = (kind: string, id = 'prop-1'): PropEntity => ({
	k: 'prop',
	id,
	layer: 'structures',
	kind,
	at: { x: 0, y: 0 },
	rot: 0
});

describe('formForProp', () => {
	it('builds every prop in the catalog out of more than a couple of parts', () => {
		for (const def of PROPS) {
			const form = formForProp(entity(def.id));
			expect(form.parts.length, def.id).toBeGreaterThan(3);
		}
	});

	it('gives the same object every time for the same prop', () => {
		for (const def of PROPS) {
			expect(formForProp(entity(def.id)), def.id).toEqual(formForProp(entity(def.id)));
		}
	});

	it('keeps every part on or above the ground and inside its own footprint', () => {
		for (const def of PROPS) {
			const form = formForProp(entity(def.id));
			for (const p of form.parts) {
				expect(p.at[1] + p.size[1] / 2, `${def.id} top`).toBeLessThan(form.size.h + 1.2);
				expect(p.at[1] + p.size[1] / 2, `${def.id} above ground`).toBeGreaterThan(-0.05);
				const reach = Math.max(form.size.w, form.size.d) / 2 + 0.9;
				expect(Math.hypot(p.at[0], p.at[2]), `${def.id} spread`).toBeLessThan(reach);
			}
		}
	});

	it('builds each one from more than one material', () => {
		for (const def of PROPS) {
			const colours = new Set(formForProp(entity(def.id)).parts.map((p) => p.colour));
			expect(colours.size, def.id).toBeGreaterThan(1);
		}
	});
});
