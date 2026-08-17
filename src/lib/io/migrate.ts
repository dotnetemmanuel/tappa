import { DEFAULT_LAYERS } from '../core/doc/doc.js';
import { SCHEMA_VERSION, type Doc, type EntityKind } from '../core/doc/types.js';

export const NEWER_VERSION_MESSAGE = 'Projektet är skapat i en nyare version av Täppa';

type Bag = Record<string, unknown>;
type Step = (doc: Bag) => Bag;

/** Step n turns a schema n document into a schema n+1 one, so schema 2 is one entry here. */
const STEPS: ReadonlyMap<number, Step> = new Map<number, Step>([
	// Everything schema 2 added is optional, so `withDefaults` fills the rest.
	[1, (doc) => ({ ...doc, schema: 2 })]
]);

/** Missing a kind here is a compile error, so a new entity type cannot be forgotten. */
const KINDS: Readonly<Record<EntityKind, true>> = {
	area: true,
	spot: true,
	path: true,
	line: true,
	wall: true,
	roof: true,
	plant: true,
	prop: true,
	image: true,
	dim: true,
	label: true
};

/** Bring any older document up to SCHEMA_VERSION, or throw a clear Error if it is newer than we understand. */
export function migrate(raw: unknown): Doc {
	let bag = expectBag(raw, 'Projektfilen');
	let version = schemaOf(bag);
	if (version > SCHEMA_VERSION) throw new Error(NEWER_VERSION_MESSAGE);

	while (version < SCHEMA_VERSION) {
		const step = STEPS.get(version);
		if (!step) throw new Error(`Projektet har schema ${version}, som inte går att uppgradera.`);
		bag = step(bag);
		const next = schemaOf(bag);
		if (next <= version) {
			throw new Error(`Uppgraderingen från schema ${version} kom ingen vart.`);
		}
		version = next;
	}

	const doc: unknown = withDefaults(bag);
	validateDoc(doc);
	return doc;
}

/** Cheap structural validation with a readable message naming what was wrong. */
export function validateDoc(raw: unknown): asserts raw is Doc {
	const doc = expectBag(raw, 'Projektfilen');
	schemaOf(doc);

	const meta = expectBag(doc.meta, 'meta');
	expectString(meta.name, 'meta.name');
	expectString(meta.created, 'meta.created');
	expectString(meta.modified, 'meta.modified');
	expectNumber(meta.lat, 'meta.lat');
	expectNumber(meta.lon, 'meta.lon');
	expectNumber(meta.northOffset, 'meta.northOffset');
	expectNumber(meta.contour, 'meta.contour');

	const plot = expectBag(doc.plot, 'plot');
	expectPoints(plot.boundary, 'plot.boundary');

	const layers = expectArray(doc.layers, 'layers');
	layers.forEach((item, i) => {
		const layer = expectBag(item, `layers[${i}]`);
		expectString(layer.id, `layers[${i}].id`);
		expectString(layer.name, `layers[${i}].name`);
		expectBoolean(layer.visible, `layers[${i}].visible`);
		expectBoolean(layer.locked, `layers[${i}].locked`);
	});

	const nodes = expectBag(doc.nodes, 'nodes');
	for (const [id, at] of Object.entries(nodes)) expectPoint(at, `nodes.${id}`);

	if (!Array.isArray(doc.entities)) {
		throw new Error('Projektfilen saknar listan med objekt (entities).');
	}
	doc.entities.forEach((item, i) => {
		const entity = expectBag(item, `entities[${i}]`);
		const where = nameOf(entity, i);
		expectString(entity.id, `${where}.id`);
		expectString(entity.layer, `${where}.layer`);
		const kind = entity.k;
		if (typeof kind !== 'string') throw new Error(`Objektet ${where} saknar en typ (k).`);
		if (!(kind in KINDS)) throw new Error(`Objektet ${where} har okänd typ "${kind}".`);
		if (kind === 'spot') {
			expectPoint(entity.at, `${where}.at`);
			expectNumber(entity.z, `${where}.z`);
		}
		if (isBag(entity.grade)) {
			expectNumber(entity.grade.level, `${where}.grade.level`);
			expectNumber(entity.grade.run, `${where}.grade.run`);
		}
	});

	const assets = expectArray(doc.assets, 'assets');
	assets.forEach((item, i) => {
		const asset = expectBag(item, `assets[${i}]`);
		expectString(asset.id, `assets[${i}].id`);
		expectString(asset.hash, `assets[${i}].hash`);
		expectString(asset.mime, `assets[${i}].mime`);
		expectNumber(asset.w, `assets[${i}].w`);
		expectNumber(asset.h, `assets[${i}].h`);
		expectNumber(asset.bytes, `assets[${i}].bytes`);
	});
}

function withDefaults(bag: Bag): Bag {
	const meta = isBag(bag.meta) ? { ...bag.meta } : bag.meta;
	if (isBag(meta) && meta.modified === undefined && typeof meta.created === 'string') {
		meta.modified = meta.created;
	}
	if (isBag(meta) && meta.contour === undefined) meta.contour = 0.25;
	return {
		...bag,
		meta,
		layers:
			bag.layers === undefined ? DEFAULT_LAYERS.map((l) => ({ ...l })) : withGroundLayer(bag.layers),
		nodes: bag.nodes === undefined ? {} : bag.nodes,
		assets: bag.assets === undefined ? [] : bag.assets
	};
}

/** A document drawn before terrain existed has no ground layer, and the height points need one. */
function withGroundLayer(layers: unknown): unknown {
	if (!Array.isArray(layers)) return layers;
	if (layers.some((l) => isBag(l) && l.id === 'ground')) return layers;
	const ground = DEFAULT_LAYERS.find((l) => l.id === 'ground');
	if (!ground) return layers;
	const after = layers.findIndex((l) => isBag(l) && l.id === 'underlay');
	const out = [...layers];
	out.splice(after + 1, 0, { ...ground });
	return out;
}

function schemaOf(bag: Bag): number {
	const schema = bag.schema;
	if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
		throw new Error('Filen saknar ett giltigt schemanummer och är antagligen ingen Täppa-fil.');
	}
	return schema;
}

function nameOf(entity: Bag, i: number): string {
	return typeof entity.id === 'string' ? `"${entity.id}" (entities[${i}])` : `entities[${i}]`;
}

function isBag(value: unknown): value is Bag {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expectBag(value: unknown, where: string): Bag {
	if (!isBag(value)) throw new Error(`${where} är inte ett objekt.`);
	return value;
}

function expectArray(value: unknown, where: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${where} är inte en lista.`);
	return value;
}

function expectString(value: unknown, where: string): void {
	if (typeof value !== 'string') throw new Error(`${where} saknas eller är inte en text.`);
}

function expectNumber(value: unknown, where: string): void {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new Error(`${where} saknas eller är inte ett tal.`);
	}
}

function expectBoolean(value: unknown, where: string): void {
	if (typeof value !== 'boolean')
		throw new Error(`${where} saknas eller är varken sant eller falskt.`);
}

function expectPoint(value: unknown, where: string): void {
	const point = expectBag(value, where);
	expectNumber(point.x, `${where}.x`);
	expectNumber(point.y, `${where}.y`);
}

function expectPoints(value: unknown, where: string): void {
	expectArray(value, where).forEach((point, i) => expectPoint(point, `${where}[${i}]`));
}
