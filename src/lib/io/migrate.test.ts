import { describe, expect, it } from 'vitest';
import { createDoc } from '../core/doc/doc.js';
import { SCHEMA_VERSION, type Doc } from '../core/doc/types.js';
import { migrate, validateDoc } from './migrate.js';

function minimal(): Record<string, unknown> {
	return {
		schema: SCHEMA_VERSION,
		meta: {
			name: 'Täppan',
			created: '2026-01-02T03:04:05.000Z',
			lat: 59.4,
			lon: 17.9,
			northOffset: 0
		},
		plot: { boundary: [{ x: 0, y: 0 }] },
		entities: []
	};
}

describe('migrate', () => {
	it('leaves a valid document untouched', () => {
		const doc = createDoc('Trädgården');
		expect(migrate(structuredClone(doc))).toEqual(doc);
	});

	it('fills in missing optional fields', () => {
		const migrated = migrate(minimal());
		expect(migrated.nodes).toEqual({});
		expect(migrated.assets).toEqual([]);
		expect(migrated.layers.length).toBeGreaterThan(0);
		expect(migrated.meta.modified).toBe('2026-01-02T03:04:05.000Z');
	});

	it('rejects a document from a newer schema', () => {
		expect(() => migrate({ ...minimal(), schema: 99 })).toThrow(
			/skapat i en nyare version av Täppa/
		);
	});

	it('rejects a missing entities list', () => {
		const raw = minimal();
		delete raw.entities;
		expect(() => migrate(raw)).toThrow(/entities/);
	});

	it('names the bad kind when an entity has an unknown k', () => {
		const raw = minimal();
		raw.entities = [{ id: 'thing-1', layer: 'surfaces', k: 'pergola' }];
		expect(() => migrate(raw)).toThrow(/pergola/);
		expect(() => migrate(raw)).toThrow(/thing-1/);
	});

	it('rejects things that are not documents at all', () => {
		expect(() => migrate(null)).toThrow(Error);
		expect(() => migrate('inte ett projekt')).toThrow(Error);
		expect(() => migrate({ hello: 'world' })).toThrow(/schemanummer/);
	});

	it('names the field that is wrong', () => {
		const raw = minimal();
		raw.meta = { name: 'Täppan', created: '2026-01-02', lat: 'norr', lon: 17.9, northOffset: 0 };
		expect(() => migrate(raw)).toThrow(/meta\.lat/);
	});
});

describe('validateDoc', () => {
	it('accepts a freshly created document', () => {
		expect(() => validateDoc(createDoc())).not.toThrow();
	});

	it('rejects a node that is not a point', () => {
		const doc: Doc = createDoc();
		const broken = { ...doc, nodes: { 'node-1': { x: 1 } } };
		expect(() => validateDoc(broken)).toThrow(/nodes\.node-1\.y/);
	});
});
