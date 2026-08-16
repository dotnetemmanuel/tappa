/**
 * Deterministic per-entity randomness. A plant seeded from its id looks the
 * same on every rebuild, which is what stops the garden shimmering when a
 * renderer re-runs.
 */
export type Rng = () => number;

export function hashString(s: string): number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}

export function mulberry32(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const rngFor = (key: string): Rng => mulberry32(hashString(key));

export const between = (r: Rng, lo: number, hi: number): number => lo + r() * (hi - lo);

export const pick = <T>(r: Rng, items: readonly T[]): T => items[Math.floor(r() * items.length)];
