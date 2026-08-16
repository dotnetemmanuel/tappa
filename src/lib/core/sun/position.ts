import { getPosition, getTimes } from 'suncalc';
import type { Doc } from '../doc/types.js';

/** Where the sun is, in the plan's own frame. */
export type SunPos = {
	/** Radians above the horizon. Negative means below it. */
	altitude: number;
	/** Radians, measured clockwise from plan north, already corrected for doc.meta.northOffset. */
	azimuth: number;
	/** Unit vector pointing FROM the ground TOWARDS the sun, in scene space (x, y up, -z is plan north). */
	toSun: [number, number, number];
	up: boolean;
};

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;

/**
 * Azimuth convention: radians clockwise from the plan's +y axis, so 0 is up the page and PI/2
 * is plan east. The installed suncalc reports degrees clockwise from true north, so the only
 * correction is `northOffset`, the degrees true north sits counter-clockwise of +y.
 */
function planAzimuth(azFromNorthDeg: number, northOffsetDeg: number): number {
	const off = Number.isFinite(northOffsetDeg) ? northOffsetDeg : 0;
	return wrap((azFromNorthDeg - off) * DEG);
}

export function sunAt(doc: Doc, when: Date): SunPos {
	const p = getPosition(when, doc.meta.lat, doc.meta.lon);
	const altitude = p.altitude * DEG;
	const azimuth = planAzimuth(p.azimuth, doc.meta.northOffset);
	const horiz = Math.cos(altitude);
	const east = Math.sin(azimuth) * horiz;
	const north = Math.cos(azimuth) * horiz;
	return {
		altitude,
		azimuth,
		toSun: [east, Math.sin(altitude), -north],
		up: altitude > 0
	};
}

export function sunTimes(
	doc: Doc,
	day: Date
): { sunrise: Date; sunset: Date; noon: Date; up: boolean } {
	const midday = atTime(day, 12, 0);
	const t = getTimes(midday, doc.meta.lat, doc.meta.lon);
	const noon = Number.isFinite(t.solarNoon.getTime()) ? t.solarNoon : midday;
	const rise = t.sunrise;
	const set = t.sunset;
	if (rise && set && set.getTime() > rise.getTime()) {
		return { sunrise: rise, sunset: set, noon, up: true };
	}
	// Midsummer above the arctic circle, or midwinter below it: no rise and no set to work from.
	if (t.alwaysUp === true || (t.alwaysDown !== true && sunAt(doc, noon).altitude > 0)) {
		return { sunrise: atTime(day, 0, 0), sunset: atTime(day, 24, 0), noon, up: true };
	}
	return { sunrise: noon, sunset: noon, noon, up: false };
}

/** Sample times across a day at a fixed step, sunrise to sunset inclusive. */
export function daySamples(doc: Doc, day: Date, stepMinutes: number): Date[] {
	const t = sunTimes(doc, day);
	const from = t.sunrise.getTime();
	const span = t.sunset.getTime() - from;
	if (!t.up || !(span > 0)) return [];
	const step = Math.max(1, stepMinutes) * 60_000;
	// The step is stretched to divide the day exactly, so every sample stands for an equal slice.
	const n = Math.max(1, Math.round(span / step));
	const out: Date[] = [];
	for (let i = 0; i <= n; i++) out.push(new Date(from + (span * i) / n));
	return out;
}

const LIGHT_STOPS: readonly { deg: number; rgb: readonly [number, number, number] }[] = [
	{ deg: -6, rgb: [64, 82, 116] },
	{ deg: 0, rgb: [255, 137, 61] },
	{ deg: 6, rgb: [255, 186, 112] },
	{ deg: 20, rgb: [255, 229, 186] },
	{ deg: 60, rgb: [255, 247, 233] }
];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

const hex2 = (x: number): string =>
	Math.round(Math.min(255, Math.max(0, x)))
		.toString(16)
		.padStart(2, '0');

const rgbHex = (c: readonly [number, number, number]): string =>
	`#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;

function rampColour(deg: number): string {
	const first = LIGHT_STOPS[0];
	if (deg <= first.deg) return rgbHex(first.rgb);
	for (let i = 1; i < LIGHT_STOPS.length; i++) {
		const b = LIGHT_STOPS[i];
		if (deg > b.deg) continue;
		const a = LIGHT_STOPS[i - 1];
		const t = (deg - a.deg) / (b.deg - a.deg);
		return rgbHex([
			a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t,
			a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t,
			a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t
		]);
	}
	return rgbHex(LIGHT_STOPS[LIGHT_STOPS.length - 1].rgb);
}

/** Sky and light colour for the current altitude, so dusk is not lit like noon. */
export function sunLight(p: SunPos): { colour: string; intensity: number; ambient: number } {
	const alt = Number.isFinite(p.altitude) ? p.altitude : 0;
	// Direct light follows sin(altitude), which is the share of a beam flat ground actually catches.
	const intensity = alt > 0 ? clamp01(Math.sin(alt)) : 0;
	const twilight = clamp01(alt / DEG / 6 + 1);
	const ambient = alt > 0 ? 0.12 + 0.23 * clamp01(Math.sin(alt)) : 0.03 + 0.09 * twilight;
	return { colour: rampColour(alt / DEG), intensity, ambient };
}

/** A local Date for a given day, hour and minute, avoiding timezone surprises. */
export function atTime(day: Date, hours: number, minutes: number): Date {
	const total = hours * 60 + minutes;
	const h = Math.floor(total / 60);
	const m = Math.floor(total - h * 60);
	const s = Math.round((total - h * 60 - m) * 60);
	return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, s, 0);
}
