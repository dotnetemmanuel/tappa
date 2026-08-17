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

	it('lifts a schema 1 document to schema 2 without touching what it drew', () => {
		const entities = [{ id: 'area-1', layer: 'surfaces', k: 'area', mat: { id: 'lawn' }, ring: [] }];
		const raw = { ...minimal(), schema: 1, entities: structuredClone(entities) };
		const migrated = migrate(raw);
		expect(migrated.schema).toBe(2);
		expect(migrated.meta.contour).toBe(0.25);
		expect(migrated.layers.filter((l) => l.id === 'ground')).toHaveLength(1);
		expect(migrated.entities).toEqual(entities);
	});

	it('does not add a second ground layer to a document that has one', () => {
		const raw = {
			...minimal(),
			schema: 1,
			layers: [{ id: 'ground', name: 'Egna marknivåer', visible: false, locked: true }]
		};
		const migrated = migrate(raw);
		expect(migrated.layers.filter((l) => l.id === 'ground')).toHaveLength(1);
		expect(migrated.layers[0].name).toBe('Egna marknivåer');
	});

	it('keeps a height point through validation', () => {
		const raw = minimal();
		raw.entities = [{ id: 'spot-1', layer: 'ground', k: 'spot', at: { x: 2, y: 3 }, z: -1.8 }];
		expect(migrate(raw).entities[0]).toEqual({
			id: 'spot-1',
			layer: 'ground',
			k: 'spot',
			at: { x: 2, y: 3 },
			z: -1.8
		});
	});

	it('rejects a height point without a height', () => {
		const raw = minimal();
		raw.entities = [{ id: 'spot-1', layer: 'ground', k: 'spot', at: { x: 2, y: 3 }, z: 'högt' }];
		expect(() => migrate(raw)).toThrow(/spot-1/);
		expect(() => migrate(raw)).toThrow(/\.z/);
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
