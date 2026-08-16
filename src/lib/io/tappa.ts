import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';
import type { AssetId, Doc } from '../core/doc/types.js';
import { migrate } from './migrate.js';

export type AssetBlob = { id: AssetId; mime: string; bytes: Uint8Array };

export const TAPPA_MIME = 'application/x-tappa';

const PROJECT_ENTRY = 'project.json';
const ASSET_DIR = 'assets/';

const EXTENSIONS: Readonly<Record<string, string>> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/avif': 'avif',
	'image/gif': 'gif',
	'image/svg+xml': 'svg'
};

/** Serialise a document plus its image bytes into a .tappa zip. */
export function packTappa(doc: Doc, assets: readonly AssetBlob[]): Uint8Array {
	const files: Zippable = {
		[PROJECT_ENTRY]: strToU8(JSON.stringify(doc, null, '\t'))
	};
	for (const asset of assets) {
		// Images are already compressed, so deflating them again only costs time.
		files[`${ASSET_DIR}${asset.id}.${extensionFor(asset.mime)}`] = [asset.bytes, { level: 0 }];
	}
	return zipSync(files, { level: 6 });
}

/** Read a .tappa zip back. Throws a readable Error for a zip that is not one of ours. */
export function unpackTappa(zip: Uint8Array): { doc: Doc; assets: AssetBlob[] } {
	let files: Unzipped;
	try {
		files = unzipSync(zip);
	} catch {
		throw new Error(
			'Filen går inte att läsa. Den är inte ett zip-arkiv och därför ingen .tappa-fil.'
		);
	}

	const projectBytes = files[PROJECT_ENTRY];
	if (!projectBytes) {
		throw new Error(`Filen saknar ${PROJECT_ENTRY} och är därför ingen .tappa-fil.`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(strFromU8(projectBytes));
	} catch {
		throw new Error(`${PROJECT_ENTRY} i filen är trasig och går inte att tolka.`);
	}

	const doc = migrate(parsed);
	const bytesById = new Map<string, Uint8Array>();
	for (const [name, bytes] of Object.entries(files)) {
		if (!name.startsWith(ASSET_DIR) || name.endsWith('/')) continue;
		bytesById.set(assetIdFromEntry(name), bytes);
	}

	const assets: AssetBlob[] = [];
	const kept = doc.assets.filter((ref) => {
		const bytes = bytesById.get(ref.id);
		if (!bytes) return false;
		assets.push({ id: ref.id, mime: ref.mime, bytes });
		return true;
	});

	return { doc: { ...doc, assets: kept }, assets };
}

export function suggestFilename(doc: Doc): string {
	return `${slug(doc.meta.name)}-${dateStamp(doc)}.tappa`;
}

function assetIdFromEntry(name: string): string {
	const base = name.slice(ASSET_DIR.length);
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(0, dot) : base;
}

function extensionFor(mime: string): string {
	return EXTENSIONS[mime] ?? 'bin';
}

function dateStamp(doc: Doc): string {
	const stamp = doc.meta.modified || doc.meta.created;
	const parsed = new Date(stamp);
	const when = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
	return when.toISOString().slice(0, 10);
}

function slug(name: string): string {
	const plain = name
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ø/gi, 'o')
		.replace(/æ/gi, 'ae')
		.toLowerCase();
	const safe = plain
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48)
		.replace(/-+$/, '');
	return safe || 'tappa';
}
