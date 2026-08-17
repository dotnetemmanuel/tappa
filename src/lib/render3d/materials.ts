import { Color, DoubleSide, MeshStandardMaterial, RepeatWrapping, Texture } from 'three';
import { material as materialDef } from '../core/doc/materials.js';
import type { MaterialId, SurfaceMat } from '../core/doc/types.js';

const ROUGHNESS: Partial<Record<MaterialId, number>> = {
	water: 0.12,
	paving: 0.75,
	concrete: 0.85,
	asphalt: 0.9,
	deck: 0.7,
	gravel: 0.95,
	lawn: 1,
	meadow: 1
};

const cache = new Map<string, MeshStandardMaterial>();

function keyOf(m: SurfaceMat): string {
	return `${m.id}|${m.fill ?? ''}|${m.asset ?? ''}|${m.repeat ?? ''}|${m.rot ?? ''}`;
}

/** Cached so a hundred lawn areas share one material and one shader compile. */
export function surfaceMaterial(m: SurfaceMat, texture?: Texture | null): MeshStandardMaterial {
	const key = keyOf(m) + (texture ? '|tex' : '');
	const hit = cache.get(key);
	if (hit) return hit;

	const def = materialDef(m.id);
	const mat = new MeshStandardMaterial({
		color: new Color(m.fill ?? def.fill),
		roughness: ROUGHNESS[m.id] ?? 0.9,
		metalness: 0,
		side: DoubleSide
	});
	if (m.id === 'water') {
		mat.transparent = true;
		mat.opacity = 0.82;
	}
	if (texture) {
		const t = texture.clone();
		t.wrapS = RepeatWrapping;
		t.wrapT = RepeatWrapping;
		const repeat = m.repeat && m.repeat > 0 ? 1 / m.repeat : 1;
		t.repeat.set(repeat, repeat);
		t.rotation = m.rot ?? 0;
		t.needsUpdate = true;
		mat.map = t;
		mat.color.set('#ffffff');
	}
	cache.set(key, mat);
	return mat;
}

const plain = new Map<string, MeshStandardMaterial>();

/** A flat coloured material, for plant masses and structure parts. */
export function colourMaterial(hex: string, opts: { rough?: number; flat?: boolean } = {}): MeshStandardMaterial {
	const key = `${hex}|${opts.rough ?? 0.9}|${opts.flat ? 1 : 0}`;
	const hit = plain.get(key);
	if (hit) return hit;
	const mat = new MeshStandardMaterial({
		color: new Color(hex),
		roughness: opts.rough ?? 0.9,
		metalness: 0,
		flatShading: opts.flat ?? false
	});
	plain.set(key, mat);
	return mat;
}

let terrainMat: MeshStandardMaterial | null = null;

/** The ground carries its own colour per vertex, which is what makes a gentle slope read. */
export function terrainMaterial(): MeshStandardMaterial {
	if (terrainMat) return terrainMat;
	terrainMat = new MeshStandardMaterial({
		color: new Color('#ffffff'),
		vertexColors: true,
		roughness: 1,
		metalness: 0
	});
	return terrainMat;
}

export function glassMaterial(): MeshStandardMaterial {
	return colourMaterial('#8fb3c4', { rough: 0.15 });
}

export function disposeMaterials(): void {
	for (const m of cache.values()) {
		m.map?.dispose();
		m.dispose();
	}
	for (const m of plain.values()) m.dispose();
	cache.clear();
	plain.clear();
}
