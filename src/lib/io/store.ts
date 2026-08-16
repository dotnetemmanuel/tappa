import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Doc } from '../core/doc/types.js';

export type ProjectSummary = { id: string; name: string; updated: string; thumb?: Blob };

type ProjectRow = { id: string; name: string; doc: Doc; updated: string; thumb?: Blob };

type AssetRow = {
	hash: string;
	mime: string;
	blob: Blob;
	w: number;
	h: number;
	bytes: number;
	refs: number;
};

interface TappaDB extends DBSchema {
	projects: { key: string; value: ProjectRow };
	assets: { key: string; value: AssetRow };
	kv: { key: string; value: unknown };
}

const DB_NAME = 'tappa';
const DB_VERSION = 1;

let opening: Promise<IDBPDatabase<TappaDB> | null> | null = null;

export function isStorageAvailable(): boolean {
	try {
		return typeof globalThis.indexedDB !== 'undefined' && globalThis.indexedDB !== null;
	} catch {
		return false;
	}
}

/** Null whenever storage is out of reach, so every caller can degrade instead of throwing. */
async function db(): Promise<IDBPDatabase<TappaDB> | null> {
	if (!isStorageAvailable()) return null;
	opening ??= openDB<TappaDB>(DB_NAME, DB_VERSION, {
		upgrade(database) {
			if (!database.objectStoreNames.contains('projects')) {
				database.createObjectStore('projects', { keyPath: 'id' });
			}
			if (!database.objectStoreNames.contains('assets')) {
				database.createObjectStore('assets', { keyPath: 'hash' });
			}
			if (!database.objectStoreNames.contains('kv')) database.createObjectStore('kv');
		}
	}).catch(() => {
		opening = null;
		return null;
	});
	return opening;
}

export async function listProjects(): Promise<ProjectSummary[]> {
	const database = await db();
	if (!database) return [];
	const rows = await database.getAll('projects');
	return rows
		.map(({ id, name, updated, thumb }) => ({ id, name, updated, thumb }))
		.sort((a, b) => b.updated.localeCompare(a.updated));
}

export async function loadProject(id: string): Promise<Doc | null> {
	const database = await db();
	if (!database) return null;
	const row = await database.get('projects', id);
	return row ? row.doc : null;
}

export async function saveProject(id: string, doc: Doc, thumb?: Blob): Promise<void> {
	const database = await db();
	if (!database) return;
	const row: ProjectRow = {
		id,
		name: doc.meta.name,
		doc,
		updated: new Date().toISOString(),
		...(thumb ? { thumb } : {})
	};
	await database.put('projects', row);
}

export async function deleteProject(id: string): Promise<void> {
	const database = await db();
	if (!database) return;
	await database.delete('projects', id);
}

/** Store bytes once, keyed by content hash. Returns the hash; bumps the ref count. */
export async function putAsset(
	blob: Blob,
	meta: { mime: string; w: number; h: number }
): Promise<string> {
	const buffer = await blob.arrayBuffer();
	const hash = await sha256Hex(buffer);
	const database = await db();
	if (!database) return hash;
	const tx = database.transaction('assets', 'readwrite');
	const existing = await tx.store.get(hash);
	await tx.store.put(
		existing
			? { ...existing, refs: existing.refs + 1 }
			: { hash, mime: meta.mime, blob, w: meta.w, h: meta.h, bytes: buffer.byteLength, refs: 1 }
	);
	await tx.done;
	return hash;
}

export async function getAsset(hash: string): Promise<Blob | null> {
	const database = await db();
	if (!database) return null;
	const row = await database.get('assets', hash);
	return row ? row.blob : null;
}

export async function retainAsset(hash: string): Promise<void> {
	await bumpRefs(hash, 1);
}

/** Drops the blob when the last reference goes. */
export async function releaseAsset(hash: string): Promise<void> {
	await bumpRefs(hash, -1);
}

async function bumpRefs(hash: string, by: number): Promise<void> {
	const database = await db();
	if (!database) return;
	const tx = database.transaction('assets', 'readwrite');
	const row = await tx.store.get(hash);
	if (row) {
		const refs = row.refs + by;
		if (refs > 0) await tx.store.put({ ...row, refs });
		else await tx.store.delete(hash);
	}
	await tx.done;
}

/** Delete every asset no live document references. Returns how many went. */
export async function collectGarbage(liveHashes: ReadonlySet<string>): Promise<number> {
	const database = await db();
	if (!database) return 0;
	const tx = database.transaction('assets', 'readwrite');
	const hashes = await tx.store.getAllKeys();
	let dropped = 0;
	for (const hash of hashes) {
		if (liveHashes.has(hash)) continue;
		await tx.store.delete(hash);
		dropped++;
	}
	await tx.done;
	return dropped;
}

export async function getKV<T>(key: string): Promise<T | null> {
	const database = await db();
	if (!database) return null;
	const value = await database.get('kv', key);
	return value === undefined ? null : (value as T);
}

export async function setKV(key: string, value: unknown): Promise<void> {
	const database = await db();
	if (!database) return;
	await database.put('kv', value, key);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
