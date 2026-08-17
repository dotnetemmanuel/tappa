import type { Vec2 } from '../geom/vec2.js';
import type { HeightField } from './field.js';

export type ContourLine = { z: number; pts: Vec2[] };

const MAX_LEVELS = 400;

/**
 * Marching squares over the field, one polyline set per level. Segments are joined
 * end to end, so a closed ring comes back as one line whose ends meet.
 */
export function contourLines(f: HeightField, interval: number): ContourLine[] {
	if (!Number.isFinite(interval) || interval <= 0) return [];
	let lo = Infinity;
	let hi = -Infinity;
	for (const h of f.h) {
		if (h < lo) lo = h;
		if (h > hi) hi = h;
	}
	if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
	const first = Math.ceil(lo / interval);
	const last = Math.floor(hi / interval);
	if (last - first + 1 > MAX_LEVELS) return [];

	const out: ContourLine[] = [];
	for (let n = first; n <= last; n++) {
		const z = n * interval;
		for (const pts of join(segmentsAt(f, z))) out.push({ z, pts });
	}
	return out;
}

type Seg = [Vec2, Vec2];

function segmentsAt(f: HeightField, z: number): Seg[] {
	const segs: Seg[] = [];
	for (let j = 0; j < f.ny - 1; j++) {
		for (let i = 0; i < f.nx - 1; i++) {
			const x = f.x0 + i * f.cell;
			const y = f.y0 + j * f.cell;
			const sw = f.h[j * f.nx + i];
			const se = f.h[j * f.nx + i + 1];
			const nw = f.h[(j + 1) * f.nx + i];
			const ne = f.h[(j + 1) * f.nx + i + 1];
			const code =
				(sw >= z ? 1 : 0) | (se >= z ? 2 : 0) | (ne >= z ? 4 : 0) | (nw >= z ? 8 : 0);
			if (code === 0 || code === 15) continue;

			const south = (): Vec2 => ({ x: x + f.cell * t(sw, se, z), y });
			const north = (): Vec2 => ({ x: x + f.cell * t(nw, ne, z), y: y + f.cell });
			const west = (): Vec2 => ({ x, y: y + f.cell * t(sw, nw, z) });
			const east = (): Vec2 => ({ x: x + f.cell, y: y + f.cell * t(se, ne, z) });

			switch (code) {
				case 1:
				case 14:
					segs.push([west(), south()]);
					break;
				case 2:
				case 13:
					segs.push([south(), east()]);
					break;
				case 3:
				case 12:
					segs.push([west(), east()]);
					break;
				case 4:
				case 11:
					segs.push([east(), north()]);
					break;
				case 6:
				case 9:
					segs.push([south(), north()]);
					break;
				case 7:
				case 8:
					segs.push([north(), west()]);
					break;
				default: {
					// A saddle cell can be joined two ways; the cell average picks the one that does not cross.
					const mid = (sw + se + ne + nw) / 4;
					const high = mid >= z;
					if ((code === 5) === high) {
						segs.push([west(), north()]);
						segs.push([south(), east()]);
					} else {
						segs.push([west(), south()]);
						segs.push([north(), east()]);
					}
				}
			}
		}
	}
	return segs;
}

function t(a: number, b: number, z: number): number {
	const d = b - a;
	return Math.abs(d) < 1e-12 ? 0.5 : clamp01((z - a) / d);
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Chain segments that share an endpoint into polylines, closing a ring where it meets itself. */
function join(segs: readonly Seg[]): Vec2[][] {
	const key = (p: Vec2): string => `${Math.round(p.x * 1e6)}:${Math.round(p.y * 1e6)}`;
	const ends = new Map<string, number[]>();
	segs.forEach((s, i) => {
		for (const p of s) {
			const k = key(p);
			const list = ends.get(k);
			if (list) list.push(i);
			else ends.set(k, [i]);
		}
	});

	const used = new Array<boolean>(segs.length).fill(false);
	const lines: Vec2[][] = [];

	const walk = (from: number, forward: boolean): Vec2[] => {
		const pts = forward ? [segs[from][0], segs[from][1]] : [segs[from][1], segs[from][0]];
		used[from] = true;
		for (;;) {
			const tail = pts[pts.length - 1];
			const next = (ends.get(key(tail)) ?? []).find((i) => !used[i]);
			if (next === undefined) return pts;
			const [a, b] = segs[next];
			used[next] = true;
			pts.push(key(a) === key(tail) ? b : a);
		}
	};

	for (let i = 0; i < segs.length; i++) {
		if (used[i]) continue;
		const forward = walk(i, true);
		// Walking the other way picks up the half of an open line that lay behind the seed.
		const back = walk(i, false);
		const line = back.length > 2 ? [...back.slice(2).reverse(), ...forward] : forward;
		if (line.length >= 2) lines.push(line);
	}
	return lines;
}
