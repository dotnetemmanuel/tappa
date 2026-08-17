import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createDoc } from '../core/doc/doc.js';
import { SCHEMA_VERSION, type AssetRef, type Doc } from '../core/doc/types.js';
import { packTappa, suggestFilename, unpackTappa, TAPPA_MIME, type AssetBlob } from './tappa.js';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const JPG = new Uint8Array([255, 216, 255, 224, 9, 9, 9]);

function assetRef(id: string, mime: string): AssetRef {
	return { id, hash: `${id}-hash`, name: `${id}.bin`, mime, w: 800, h: 600, bytes: 12 };
}

function sampleDoc(): Doc {
	const doc = createDoc('Min Täppa');
	doc.meta.created = '2026-08-16T09:00:00.000Z';
	doc.meta.modified = '2026-08-16T09:00:00.000Z';
	doc.plot.boundary = [
		{ x: 0, y: 0 },
		{ x: 20, y: 0 },
		{ x: 20, y: 15.5 },
		{ x: 0, y: 15.5 }
	];
	doc.nodes = { 'node-1': { x: 1, y: 1 }, 'node-2': { x: 9.25, y: 1 } };
	doc.entities = [
		{
			id: 'area-1',
			layer: 'surfaces',
			k: 'area',
			mat: { id: 'lawn' },
			ring: [
				{ x: 0.5, y: 0.5 },
				{ x: 8, y: 0.5 },
				{ x: 8, y: 6.125 }
			],
			holes: [
				[
					{ x: 2, y: 2 },
					{ x: 3, y: 2 },
					{ x: 3, y: 3 }
				]
			]
		},
		{
			id: 'path-1',
			layer: 'surfaces',
			k: 'path',
			mat: { id: 'gravel' },
			spine: [
				{ x: 0, y: 10 },
				{ x: 12.75, y: 10 }
			],
			width: 1.2
		},
		{
			id: 'line-1',
			layer: 'structures',
			k: 'line',
			style: { id: 'fence' },
			spine: [
				{ x: 0, y: 15 },
				{ x: 20, y: 15 }
			],
			height: 1.8,
			thickness: 0.1
		},
		{
			id: 'wall-1',
			layer: 'structures',
			k: 'wall',
			a: 'node-1',
			b: 'node-2',
			thickness: 0.25,
			height: 2.7,
			openings: [{ id: 'op-1', type: 'door', t: 0.4, width: 0.9, height: 2.1, sill: 0 }]
		},
		{
			id: 'roof-1',
			layer: 'structures',
			k: 'roof',
			over: ['wall-1'],
			type: 'gable',
			pitchDeg: 27,
			ridgeDeg: 90,
			overhang: 0.4
		},
		{
			id: 'plant-1',
			layer: 'planting',
			k: 'plant',
			species: 'malus-domestica',
			at: { x: 4.125, y: 7.875 },
			rot: Math.PI / 4,
			sizeJitter: 0.12,
			plantedYear: 2024
		},
		{
			id: 'prop-1',
			layer: 'structures',
			k: 'prop',
			kind: 'bench',
			at: { x: 6, y: 3 },
			rot: Math.PI / 2,
			scale: 1.25,
			params: { length: 1.8 }
		},
		{
			id: 'image-1',
			layer: 'underlay',
			k: 'image',
			asset: 'asset-1',
			transform: { at: { x: 10, y: 7.5 }, rot: 0.1, mPerPx: 0.0254 },
			opacity: 0.6,
			mode: 'underlay',
			locked: true
		},
		{
			id: 'dim-1',
			layer: 'annotation',
			k: 'dim',
			from: { k: 'vertex', e: 'area-1', i: 0 },
			to: { k: 'free', at: { x: 8, y: 0.5 } },
			offset: 0.75,
			text: '7,50 m'
		},
		{
			id: 'label-1',
			layer: 'annotation',
			k: 'label',
			at: { x: 2.5, y: 12 },
			text: 'Köksland',
			size: 0.4,
			rot: 0
		}
	];
	doc.assets = [assetRef('asset-1', 'image/png')];
	return doc;
}

describe('packTappa and unpackTappa', () => {
	it('round-trips a document with several entity kinds', () => {
		const doc = sampleDoc();
		const assets: AssetBlob[] = [{ id: 'asset-1', mime: 'image/png', bytes: PNG }];
		const back = unpackTappa(packTappa(doc, assets));

		expect(back.doc).toEqual(doc);
		expect(back.doc.entities.map((e) => e.k)).toEqual([
			'area',
			'path',
			'line',
			'wall',
			'roof',
			'plant',
			'prop',
			'image',
			'dim',
			'label'
		]);
		expect(back.assets).toHaveLength(1);
		expect(back.assets[0].bytes).toEqual(PNG);
	});

	it('keeps geometry identical down to the decimal', () => {
		const doc = sampleDoc();
		const back = unpackTappa(packTappa(doc, []));
		const area = back.doc.entities.find((e) => e.id === 'area-1');
		const plant = back.doc.entities.find((e) => e.id === 'plant-1');
		if (area?.k !== 'area' || plant?.k !== 'plant')
			throw new Error('entiteterna kom inte tillbaka');
		expect(area.ring).toEqual([
			{ x: 0.5, y: 0.5 },
			{ x: 8, y: 0.5 },
			{ x: 8, y: 6.125 }
		]);
		expect(plant.at).toEqual({ x: 4.125, y: 7.875 });
		expect(plant.rot).toBe(Math.PI / 4);
		expect(back.doc.nodes['node-2']).toEqual({ x: 9.25, y: 1 });
	});

	it('writes project.json with tab indentation', () => {
		const zip = packTappa(createDoc('Täppan'), []);
		const text = new TextDecoder().decode(entryOf(zip, 'project.json'));
		expect(text).toContain(`\n\t"schema": ${SCHEMA_VERSION}`);
	});

	it('carries several assets with the right file extensions', () => {
		const doc = sampleDoc();
		doc.assets = [assetRef('asset-1', 'image/png'), assetRef('asset-2', 'image/jpeg')];
		const packed = packTappa(doc, [
			{ id: 'asset-1', mime: 'image/png', bytes: PNG },
			{ id: 'asset-2', mime: 'image/jpeg', bytes: JPG }
		]);
		expect(entryOf(packed, 'assets/asset-1.png')).toEqual(PNG);
		expect(entryOf(packed, 'assets/asset-2.jpg')).toEqual(JPG);
		expect(unpackTappa(packed).assets.map((a) => a.id)).toEqual(['asset-1', 'asset-2']);
	});

	it('throws a readable error for bytes that are not a zip', () => {
		const notAZip = strToU8('detta är inte ett zip-arkiv, bara text');
		let message = '';
		try {
			unpackTappa(notAZip);
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		}
		expect(message).toMatch(/\.tappa/);
		expect(message).toMatch(/zip/);
		expect(message.length).toBeLessThan(160);
	});

	it('throws for an empty file', () => {
		expect(() => unpackTappa(new Uint8Array(0))).toThrow(Error);
	});

	it('throws for a zip without project.json', () => {
		const zip = zipSync({ 'readme.txt': strToU8('hej') });
		expect(() => unpackTappa(zip)).toThrow(/project\.json/);
	});

	it('throws for a zip whose project.json is not JSON', () => {
		const zip = zipSync({ 'project.json': strToU8('{ trasig') });
		expect(() => unpackTappa(zip)).toThrow(/project\.json/);
	});

	it('drops an asset the document references but the zip does not hold', () => {
		const doc = sampleDoc();
		doc.assets = [assetRef('asset-1', 'image/png'), assetRef('asset-2', 'image/jpeg')];
		const packed = packTappa(doc, [{ id: 'asset-1', mime: 'image/png', bytes: PNG }]);
		const back = unpackTappa(packed);
		expect(back.doc.assets.map((a) => a.id)).toEqual(['asset-1']);
		expect(back.assets.map((a) => a.id)).toEqual(['asset-1']);
	});

	it('ignores an asset in the zip that nothing references', () => {
		const doc = sampleDoc();
		const packed = packTappa(doc, [
			{ id: 'asset-1', mime: 'image/png', bytes: PNG },
			{ id: 'asset-9', mime: 'image/jpeg', bytes: JPG }
		]);
		const back = unpackTappa(packed);
		expect(back.doc.assets.map((a) => a.id)).toEqual(['asset-1']);
		expect(back.assets.map((a) => a.id)).toEqual(['asset-1']);
	});

	it('runs the document through migrate on the way in', () => {
		const zip = zipSync({
			'project.json': strToU8(JSON.stringify({ ...createDoc(), schema: 99 }))
		});
		expect(() => unpackTappa(zip)).toThrow(/nyare version av Täppa/);
	});

	it('names the file type', () => {
		expect(TAPPA_MIME).toBe('application/x-tappa');
	});
});

describe('suggestFilename', () => {
	it('makes a filesystem safe name from spaces, slashes and Swedish characters', () => {
		const doc = createDoc('Min Täppa / Söderäng 2:14');
		doc.meta.modified = '2026-08-16T09:00:00.000Z';
		expect(suggestFilename(doc)).toBe('min-tappa-soderang-2-14-2026-08-16.tappa');
	});

	it('falls back when the name has nothing usable in it', () => {
		const doc = createDoc('///');
		doc.meta.modified = '2026-08-16T09:00:00.000Z';
		expect(suggestFilename(doc)).toBe('tappa-2026-08-16.tappa');
	});

	it('keeps the name short and free of path separators', () => {
		const doc = createDoc('a'.repeat(200));
		doc.meta.modified = '2026-08-16T09:00:00.000Z';
		const name = suggestFilename(doc);
		expect(name).not.toMatch(/[/\\:*?"<>|]/);
		expect(name.length).toBeLessThanOrEqual(70);
	});
});

function entryOf(zip: Uint8Array, entry: string): Uint8Array {
	const bytes = unzipSync(zip)[entry];
	if (!bytes) throw new Error(`Arkivet saknar ${entry}`);
	return bytes;
}
