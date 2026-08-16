import type { Hex, PropId } from '../doc/types.js';
import type { Rng } from '../rng.js';
import type { Vec2 } from '../geom/vec2.js';

/**
 * One primitive of a garden object. Both renderers read these: 3D makes meshes,
 * the plan draws the footprint of the widest parts.
 */
export type Part = {
	shape: 'box' | 'cyl' | 'sphere' | 'cone' | 'plane';
	/** Centre, metres, y is height above ground. */
	at: [number, number, number];
	/** Full extents, metres. For cyl and cone, size[0] is the diameter. */
	size: [number, number, number];
	colour: Hex;
	/** Rotation about the vertical axis, radians. */
	rotY?: number;
	/** Tilt about the local x axis, radians, for a lid or a sloped roof. */
	tiltX?: number;
	opacity?: number;
};

export type PropCat = 'sitting' | 'growing' | 'structure' | 'play' | 'utility' | 'water' | 'nature';

export type PropParam = {
	key: string;
	sv: string;
	min: number;
	max: number;
	step: number;
	default: number;
};

export type PropDef = {
	id: PropId;
	sv: string;
	en: string;
	cat: PropCat;
	/** Plan footprint in metres, used for hit testing and the plan symbol. */
	footprint: { w: number; d: number };
	/** Whether the plan symbol is a rounded rectangle or a circle. */
	planShape: 'rect' | 'round';
	/** Sizes the inspector lets the user change. */
	params: PropParam[];
	/** True when this thing casts a shadow worth including in the sun study. */
	occludes: boolean;
};

export type PropForm = {
	parts: Part[];
	/** Overall size at the current parameters, metres. */
	size: { w: number; d: number; h: number };
	/** Plan outline, centred on the prop's own origin. */
	outline: Vec2[];
	stroke: Hex;
	fill: Hex;
};

export type PropInput = {
	def: PropDef;
	params: Record<string, number>;
	rng: Rng;
};
