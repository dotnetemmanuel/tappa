import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	DoubleSide,
	Group,
	InstancedMesh,
	LineBasicMaterial,
	LineSegments,
	Matrix4,
	Mesh,
	MeshStandardMaterial,
	Object3D,
	PlaneGeometry,
	Quaternion,
	SphereGeometry,
	Vector3
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildRoof } from '../core/building/roof.js';
import { placements } from '../core/building/openings.js';
import { wallParts } from '../core/building/wallgraph.js';
import { docBounds } from '../core/doc/doc.js';
import { lineStyle } from '../core/doc/materials.js';
import type { Doc, Entity, EntityId, LineEntity, PlantEntity, PropEntity } from '../core/doc/types.js';
import { distToRing, pointInRing, strokeToRing } from '../core/geom/polygon.js';
import type { Vec2 } from '../core/geom/vec2.js';
import { speciesOr } from '../core/plants/catalog.js';
import { seasonOf, sizeAt } from '../core/plants/growth.js';
import { plantForm } from '../core/plants/archetypes.js';
import type { Limb, Mass, PlantForm } from '../core/plants/types.js';
import { formForProp } from '../core/props/builders.js';
import type { Part, PropForm } from '../core/props/types.js';
import { contourLines } from '../core/terrain/contour.js';
import { heightAt, type HeightField } from '../core/terrain/field.js';
import { drape, groundUnder, profileAlong, type DrapedMesh } from '../core/terrain/query.js';
import {
	colourMaterial,
	glassMaterial,
	partMaterial,
	plantMaterial,
	surfaceMaterial,
	terrainMaterial
} from './materials.js';
import { prismToGeometry, ribbonToGeometry, ringToGeometry, solidToGeometry } from './geometry.js';

/** Surfaces are lifted a few millimetres apart so co-planar areas do not z-fight. */
const LAYER_LIFT = 0.004;

export type BuildContext = {
	doc: Doc;
	/** The baked ground, or null on a flat plot. */
	field: HeightField | null;
	/** Global years since planting, from the age slider. */
	years: number;
	/** Month 1 to 12, drives season, bloom and dieback. */
	month: number;
	texture: (assetId: string) => import('three').Texture | null;
};

const unitSphere = new SphereGeometry(0.5, 10, 7);
const unitCone = new ConeGeometry(0.5, 1, 10);
const unitCylinder = new CylinderGeometry(0.5, 0.5, 1, 14);
const unitBox = new BoxGeometry(1, 1, 1);
const unitPlane = new PlaneGeometry(1, 1);

function massGeometry(m: Mass): BufferGeometry {
	const src =
		m.kind === 'cone' || m.kind === 'spire'
			? unitCone
			: m.kind === 'cylinder'
				? unitCylinder
				: m.kind === 'fan'
					? unitPlane
					: unitSphere;
	const g = src.clone();
	g.scale(m.rx * 2, m.ry * 2, m.rz * 2);
	if (m.rot) g.rotateY(m.rot);
	g.translate(m.at.x, m.at.y, m.at.z);
	return g;
}

function partGeometry(p: Part): BufferGeometry {
	const src =
		p.shape === 'cyl'
			? unitCylinder
			: p.shape === 'sphere'
				? unitSphere
				: p.shape === 'cone'
					? unitCone
					: p.shape === 'plane'
						? unitPlane
						: unitBox;
	const g = src.clone();
	g.scale(p.size[0], p.size[1], p.size[2]);
	if (p.tiltX) g.rotateX(p.tiltX);
	if (p.rotY) g.rotateY(p.rotY);
	g.translate(p.at[0], p.at[1], p.at[2]);
	return g;
}

/** Merge parts that share a colour, so a bench is one draw call not eleven. */
function mergeByColour(
	items: { colour: string; opacity?: number; geometry: BufferGeometry }[]
): Mesh[] {
	const groups = new Map<string, { colour: string; opacity: number; parts: BufferGeometry[] }>();
	for (const it of items) {
		const opacity = it.opacity ?? 1;
		const key = `${it.colour}|${opacity}`;
		const g = groups.get(key) ?? { colour: it.colour, opacity, parts: [] };
		g.parts.push(it.geometry);
		groups.set(key, g);
	}
	const out: Mesh[] = [];
	for (const g of groups.values()) {
		const merged = g.parts.length === 1 ? g.parts[0] : mergeGeometries(g.parts, false);
		if (!merged) continue;
		merged.computeVertexNormals();
		// Built things have hard edges; smoothing them across a corner is what makes a box look soft.
		const mat =
			g.colour === 'vertex' ? partMaterial() : colourMaterial(g.colour, { rough: 0.85, flat: true });
		const mesh = new Mesh(merged, g.opacity < 1 ? transparentOf(mat, g.opacity) : mat);
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		out.push(mesh);
		if (g.parts.length > 1) for (const p of g.parts) p.dispose();
	}
	return out;
}

const transparentCache = new Map<string, MeshStandardMaterial>();
function transparentOf(base: MeshStandardMaterial, opacity: number): MeshStandardMaterial {
	const key = `${base.color.getHexString()}|${opacity}`;
	const hit = transparentCache.get(key);
	if (hit) return hit;
	const m = base.clone();
	m.transparent = true;
	m.opacity = opacity;
	m.side = DoubleSide;
	transparentCache.set(key, m);
	return m;
}

function tagEntity(o: Object3D, id: EntityId): void {
	o.userData.entityId = id;
	o.traverse((c) => (c.userData.entityId = id));
}

// ---------------------------------------------------------------- surfaces

/** Terrain runs well past the plot, so the world does not visibly end at the boundary. */
export function buildGround(doc: Doc, field: HeightField | null): Group {
	const group = new Group();
	group.name = 'ground';
	const b = docBounds(doc);
	const centre =
		Number.isFinite(b.min.x) && b.max.x >= b.min.x
			? { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 }
			: { x: 0, y: 0 };
	const span = Math.max(
		240,
		Number.isFinite(b.min.x) ? Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y) * 6 : 240
	);
	// Past the field the ground carries on at its edge height, so the world does not end in a cliff.
	// Dense enough that the join with the detailed ground does not read as a straight edge.
	const terrain = new Mesh(
		new PlaneGeometry(span, span, 220, 220).rotateX(-Math.PI / 2),
		terrainMaterial()
	);
	if (field) liftPlane(terrain.geometry, field, centre, 0.03, doc.plot.boundary);
	else flatColours(terrain.geometry, centre);
	terrain.position.set(centre.x, -0.02, -centre.y);
	terrain.receiveShadow = true;
	terrain.name = 'terrain';

	if (field) {
		const surface = fieldToGeometry(field, doc.plot.boundary);
		if (surface) {
			const mesh = new Mesh(surface, terrainMaterial());
			mesh.receiveShadow = true;
			mesh.castShadow = true;
			mesh.name = 'terrainField';
			group.add(mesh);
		}
	}

	// With terrain the boundary is already in the ground's own colours, so this is only for a flat plot.
	if (!field && doc.plot.boundary.length >= 3) {
		const g = ringToGeometry(doc.plot.boundary, [], -0.005);
		if (g) {
			const plot = new Mesh(g, colourMaterial('#76885a', { rough: 1 }));
			plot.receiveShadow = true;
			plot.name = 'plot';
			group.add(plot);
		}
	}
	group.add(terrain);
	if (field) {
		const showGround = doc.layers.find((l) => l.id === 'ground')?.visible !== false;
		const lines = showGround ? contourMesh(field, doc.meta.contour) : null;
		if (lines) group.add(lines);
		group.add(...retainingFaces(doc, field));
	}
	return group;
}

/**
 * The plan's contour lines, laid on the 3D ground. An even slope in one flat green
 * reads as flat, and these are what make it read as a slope at a glance.
 */
function contourMesh(f: HeightField, interval: number): Object3D | null {
	const lines = contourLines(f, interval > 0 ? interval : 0.25);
	if (lines.length === 0) return null;
	const pts: number[] = [];
	for (const l of lines) {
		for (let i = 1; i < l.pts.length; i++) {
			const a = l.pts[i - 1];
			const b = l.pts[i];
			pts.push(a.x, l.z + 0.02, -a.y, b.x, l.z + 0.02, -b.y);
		}
	}
	if (pts.length === 0) return null;
	const g = new BufferGeometry();
	g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
	const mesh = new LineSegments(g, new LineBasicMaterial({ color: new Color('#4a5a3a'), transparent: true, opacity: 0.5 }));
	mesh.name = 'contours';
	return mesh;
}

/** Low ground darker and cooler, high ground lighter and warmer. Value, not hue, so plants keep the colour. */
const GROUND_LOW = new Color('#46583a');
const GROUND_HIGH = new Color('#93a266');
/** Rough land beyond the boundary: the same greens, drained and greyed, so the plot reads as yours. */
const ROUGH_LOW = new Color('#4d5545');
const ROUGH_HIGH = new Color('#89906f');
/** How far outside the boundary the garden fades into the rough, in metres. */
const EDGE_FADE = 1.5;

/**
 * Turf is never one flat colour, and a single green is what makes ground look like plastic.
 * Two octaves of value noise, hashed from the position so it is the same every rebuild and
 * never shimmers, at a few percent either side of the base.
 */
function hash2(x: number, y: number): number {
	const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
	return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const tx = x - xi;
	const ty = y - yi;
	const sx = tx * tx * (3 - 2 * tx);
	const sy = ty * ty * (3 - 2 * ty);
	const a = hash2(xi, yi);
	const b = hash2(xi + 1, yi);
	const c = hash2(xi, yi + 1);
	const d = hash2(xi + 1, yi + 1);
	return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

const patchiness = (x: number, y: number): number =>
	valueNoise(x / 3.5, y / 3.5) * 0.6 + valueNoise(x / 1.1, y / 1.1) * 0.4;

function heightRange(f: HeightField): { lo: number; hi: number } {
	let lo = Infinity;
	let hi = -Infinity;
	for (const h of f.h) {
		if (h < lo) lo = h;
		if (h > hi) hi = h;
	}
	// A dead flat field would divide by zero and a one centimetre bump would look like a mountain.
	if (!(hi - lo > 0.2)) return { lo: lo - 0.5, hi: lo + 0.5 };
	return { lo, hi };
}

/** Height gives the value, the boundary gives the tone, and the noise keeps it from reading flat. */
function groundColour(
	x: number,
	y: number,
	z: number,
	range: { lo: number; hi: number },
	garden: number,
	out: Color
): Color {
	const t = clamp01((z - range.lo) / (range.hi - range.lo));
	const rough = ROUGH_LOW.clone().lerp(ROUGH_HIGH, t);
	out.copy(GROUND_LOW).lerp(GROUND_HIGH, t).lerp(rough, 1 - garden);
	const n = (patchiness(x, y) - 0.5) * 0.12;
	out.offsetHSL(n * 0.02, n * 0.1, n);
	return out;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 1 inside the boundary, 0 out in the rough, with a metre and a half of fade between. */
function gardenAt(boundary: readonly Vec2[], p: Vec2): number {
	if (boundary.length < 3) return 1;
	const d = distToRing(p, boundary);
	return pointInRing(p, boundary) ? 1 : clamp01(1 - d / EDGE_FADE);
}

/** The height grid as a mesh, one quad per cell. */
function fieldToGeometry(f: HeightField, boundary: readonly Vec2[]): BufferGeometry | null {
	if (f.nx < 2 || f.ny < 2) return null;
	const positions = new Float32Array(f.nx * f.ny * 3);
	const uvs = new Float32Array(f.nx * f.ny * 2);
	const colours = new Float32Array(f.nx * f.ny * 3);
	const range = heightRange(f);
	const c = new Color();
	for (let j = 0; j < f.ny; j++) {
		for (let i = 0; i < f.nx; i++) {
			const k = j * f.nx + i;
			const px = f.x0 + i * f.cell;
			const py = f.y0 + j * f.cell;
			positions[k * 3] = px;
			positions[k * 3 + 1] = f.h[k];
			positions[k * 3 + 2] = -py;
			uvs[k * 2] = px;
			uvs[k * 2 + 1] = py;
			groundColour(px, py, f.h[k], range, gardenAt(boundary, { x: px, y: py }), c);
			colours[k * 3] = c.r;
			colours[k * 3 + 1] = c.g;
			colours[k * 3 + 2] = c.b;
		}
	}
	const index = new Uint32Array((f.nx - 1) * (f.ny - 1) * 6);
	let t = 0;
	for (let j = 0; j < f.ny - 1; j++) {
		for (let i = 0; i < f.nx - 1; i++) {
			const a = j * f.nx + i;
			const b = a + 1;
			const c = a + f.nx;
			const d = c + 1;
			index[t++] = a;
			index[t++] = c;
			index[t++] = b;
			index[t++] = b;
			index[t++] = c;
			index[t++] = d;
		}
	}
	const g = new BufferGeometry();
	g.setAttribute('position', new BufferAttribute(positions, 3));
	g.setAttribute('uv', new BufferAttribute(uvs, 2));
	g.setAttribute('color', new BufferAttribute(colours, 3));
	g.setIndex(new BufferAttribute(index, 1));
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

/** The surround plane follows the field where it overlaps and flattens out past its edge. */
function liftPlane(
	g: BufferGeometry,
	f: HeightField,
	centre: Vec2,
	drop: number,
	boundary: readonly Vec2[]
): void {
	const pos = g.getAttribute('position');
	const colours = new Float32Array(pos.count * 3);
	const range = heightRange(f);
	const c = new Color();
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i) + centre.x;
		const y = -pos.getZ(i) + centre.y;
		const z = heightAt(f, x, y);
		pos.setY(i, z - drop);
		groundColour(x, y, z, range, gardenAt(boundary, { x, y }), c);
		colours[i * 3] = c.r;
		colours[i * 3 + 1] = c.g;
		colours[i * 3 + 2] = c.b;
	}
	pos.needsUpdate = true;
	g.setAttribute('color', new BufferAttribute(colours, 3));
	g.computeVertexNormals();
}

/** The same turf colours on a plot with no heights at all, so flat ground is not one flat green. */
function flatColours(g: BufferGeometry, centre: Vec2): void {
	const pos = g.getAttribute('position');
	const colours = new Float32Array(pos.count * 3);
	const range = { lo: -0.5, hi: 0.5 };
	const c = new Color();
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i) + centre.x;
		const y = -pos.getZ(i) + centre.y;
		groundColour(x, y, 0, range, 1, c);
		colours[i * 3] = c.r;
		colours[i * 3 + 1] = c.g;
		colours[i * 3 + 2] = c.b;
	}
	g.setAttribute('color', new BufferAttribute(colours, 3));
}

function drapedGeometry(mesh: DrapedMesh): BufferGeometry | null {
	if (mesh.index.length === 0) return null;
	const g = new BufferGeometry();
	g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
	g.setAttribute('uv', new BufferAttribute(mesh.uvs, 2));
	g.setIndex(new BufferAttribute(mesh.index, 1));
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

/** The vertical face a terrace with a hard edge cuts into the slope. */
function retainingFaces(doc: Doc, f: HeightField): Object3D[] {
	const out: Object3D[] = [];
	for (const e of doc.entities) {
		if (e.k !== 'area' || !e.grade || e.grade.edge !== 'wall' || e.ring.length < 3) continue;
		const around = groundUnder(f, e.ring);
		const lo = Math.min(around.min, e.grade.level) - 0.15;
		const hi = Math.max(around.max, e.grade.level);
		if (hi - lo < 0.02) continue;
		const g = ribbonToGeometry(e.ring, hi - lo, lo, true);
		if (!g) continue;
		const mesh = new Mesh(g, surfaceMaterial({ id: e.grade.mat ?? 'concrete' }, null));
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		tagEntity(mesh, e.id);
		out.push(mesh);
	}
	return out;
}

function buildSurface(e: Entity, ctx: BuildContext, order: number): Object3D | null {
	if (e.k !== 'area' && e.k !== 'path') return null;
	const ring = e.k === 'area' ? e.ring : e.spine.length >= 2 ? strokeToRing(e.spine, e.width) : null;
	if (!ring || ring.length < 3) return null;
	const lift = (e.k === 'area' ? (e.elev ?? 0) : 0) + order * LAYER_LIFT;
	const holes = e.k === 'area' ? (e.holes ?? []) : [];
	const grade = e.k === 'area' ? e.grade : undefined;
	// A levelled area is flat by definition; everything else follows the ground it is laid on.
	const g = grade
		? ringToGeometry(ring, holes, grade.level + lift)
		: ctx.field
			? drapedGeometry(drape(ctx.field, ring, holes, lift, ctx.field.cell))
			: ringToGeometry(ring, holes, lift);
	if (!g) return null;
	const mesh = new Mesh(g, surfaceMaterial(e.mat, e.mat.asset ? ctx.texture(e.mat.asset) : null));
	mesh.receiveShadow = true;
	tagEntity(mesh, e.id);
	return mesh;
}

// -------------------------------------------------------------- structures

function buildFence(e: LineEntity, field: HeightField | null): Object3D | null {
	if (e.spine.length < 2) return null;
	const def = lineStyle(e.style.id);
	const colour = e.style.colour ?? def.colour;
	const group = new Group();

	if (def.render === 'hedge' || def.render === 'stone') {
		const ring = strokeToRing(e.spine, Math.max(0.2, e.thickness));
		const mat = colourMaterial(colour, { rough: 1, flat: def.render === 'stone' });
		const sides = field ? profiledRibbon(field, ring, e.height, 0, true) : prismToGeometry(ring, 0, e.height);
		if (sides) {
			const mesh = new Mesh(sides, mat);
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add(mesh);
		}
		const cap = field ? drapedGeometry(drape(field, ring, [], e.height, field.cell)) : null;
		if (cap) {
			const mesh = new Mesh(cap, mat);
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add(mesh);
		}
	} else if (def.render === 'solid' || def.render === 'panel') {
		const g = profiledRibbon(field, e.spine, e.height * (def.render === 'panel' ? 0.92 : 1), 0.02, false);
		if (g) {
			const mesh = new Mesh(g, panelMaterial(colour));
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add(mesh);
		}
		addPosts(group, e.spine, e.height, colour, 2.2, field);
	} else if (def.render === 'mesh' || def.render === 'trellis') {
		const g = profiledRibbon(field, e.spine, e.height, 0.05, false);
		if (g) {
			const mat = panelMaterial(colour);
			const see = transparentOf(mat, def.render === 'mesh' ? 0.35 : 0.5);
			group.add(new Mesh(g, see));
		}
		addPosts(group, e.spine, e.height, colour, 2.5, field);
	} else {
		addPickets(group, e.spine, e.height, colour, field);
		addPosts(group, e.spine, e.height, colour, 2, field);
	}
	tagEntity(group, e.id);
	return group.children.length > 0 ? group : null;
}

/** A fence band that rides the ground: posts stay upright, the run rakes with the slope. */
function profiledRibbon(
	field: HeightField | null,
	pts: readonly Vec2[],
	height: number,
	base: number,
	closed: boolean
): BufferGeometry | null {
	if (!field) return ribbonToGeometry(pts, height, base, closed);
	const line = closed ? [...pts, pts[0]] : pts;
	if (line.length < 2) return null;
	const samples = profileAlong(field, line, field.cell);
	if (samples.length < 2) return null;
	const positions: number[] = [];
	const uvs: number[] = [];
	const indices: number[] = [];
	let run = 0;
	for (let i = 0; i < samples.length; i++) {
		const s = samples[i];
		if (i > 0) run += Math.hypot(s.at.x - samples[i - 1].at.x, s.at.y - samples[i - 1].at.y);
		positions.push(s.at.x, s.z + base, -s.at.y, s.at.x, s.z + base + height, -s.at.y);
		uvs.push(run, 0, run, height);
	}
	for (let i = 0; i < samples.length - 1; i++) {
		const a = i * 2;
		indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
	}
	const g = new BufferGeometry();
	g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
	g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
	g.setIndex(indices);
	g.computeVertexNormals();
	g.computeBoundingSphere();
	return g;
}

const panelCache = new Map<string, MeshStandardMaterial>();
function panelMaterial(colour: string): MeshStandardMaterial {
	const hit = panelCache.get(colour);
	if (hit) return hit;
	const m = new MeshStandardMaterial({ color: new Color(colour), roughness: 0.9, side: DoubleSide });
	panelCache.set(colour, m);
	return m;
}

function walkSpine(spine: readonly Vec2[], step: number, fn: (p: Vec2, dir: Vec2) => void): void {
	let carry = 0;
	for (let i = 1; i < spine.length; i++) {
		const a = spine[i - 1];
		const b = spine[i];
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		if (len < 1e-6) continue;
		const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
		for (let d = carry; d <= len; d += step) {
			fn({ x: a.x + dir.x * d, y: a.y + dir.y * d }, dir);
			carry = d + step - len;
		}
		if (carry < 0) carry = 0;
	}
	const last = spine[spine.length - 1];
	const prev = spine[spine.length - 2] ?? last;
	const len = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
	fn(last, { x: (last.x - prev.x) / len, y: (last.y - prev.y) / len });
}

function addPosts(
	group: Group,
	spine: readonly Vec2[],
	height: number,
	colour: string,
	step: number,
	field: HeightField | null
): void {
	const parts: BufferGeometry[] = [];
	walkSpine(spine, step, (p) => {
		const g = unitBox.clone();
		g.scale(0.09, height + 0.08, 0.09);
		g.translate(p.x, heightAt(field, p.x, p.y) + (height + 0.08) / 2, -p.y);
		parts.push(g);
	});
	if (parts.length === 0) return;
	const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
	if (!merged) return;
	const mesh = new Mesh(merged, colourMaterial(colour, { rough: 0.9 }));
	mesh.castShadow = true;
	group.add(mesh);
	if (parts.length > 1) for (const p of parts) p.dispose();
}

function addPickets(
	group: Group,
	spine: readonly Vec2[],
	height: number,
	colour: string,
	field: HeightField | null
): void {
	const parts: BufferGeometry[] = [];
	walkSpine(spine, 0.12, (p, dir) => {
		const g = unitBox.clone();
		g.scale(0.035, height, 0.02);
		g.rotateY(Math.atan2(dir.x, dir.y) - Math.PI / 2);
		g.translate(p.x, heightAt(field, p.x, p.y) + height / 2, -p.y);
		parts.push(g);
	});
	if (parts.length === 0) return;
	const merged = mergeGeometries(parts, false);
	if (!merged) return;
	const mesh = new Mesh(merged, colourMaterial(colour, { rough: 0.9 }));
	mesh.castShadow = true;
	group.add(mesh);
	for (const p of parts) p.dispose();
}

function buildWalls(doc: Doc, field: HeightField | null): Object3D {
	const group = new Group();
	group.name = 'walls';
	for (const e of doc.entities) {
		if (e.k !== 'wall') continue;
		const parts = wallParts(doc, e, field);
		// The base storey takes the foundation colour, so a suterrang wall reads as a base and not as a very tall wall.
		for (const [solid, colour] of [
			[parts.storey, '#e0d9c9'],
			[parts.base, '#b5afa3']
		] as const) {
			if (solid.indices.length === 0) continue;
			const mesh = new Mesh(solidToGeometry(solid), colourMaterial(colour, { rough: 0.95 }));
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			tagEntity(mesh, e.id);
			group.add(mesh);
		}

		for (const p of placements(doc, e)) {
			const glass = new Mesh(unitPlane.clone(), glassMaterial());
			glass.scale.set(p.width, p.height, 1);
			glass.position.set(p.centre.x, parts.floor + p.sill + p.height / 2, -p.centre.y);
			glass.rotation.y = Math.atan2(p.normal.x, -p.normal.y);
			glass.userData.entityId = e.id;
			if (p.type === 'window') group.add(glass);
		}
	}
	return group;
}

function buildRoofs(doc: Doc): Object3D {
	const group = new Group();
	group.name = 'roofs';
	for (const e of doc.entities) {
		if (e.k !== 'roof') continue;
		const built = buildRoof(doc, e);
		if (!built || built.solid.indices.length === 0) continue;
		const mesh = new Mesh(solidToGeometry(built.solid), colourMaterial('#4b4c49', { rough: 0.95 }));
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		tagEntity(mesh, e.id);
		group.add(mesh);
	}
	return group;
}

// ------------------------------------------------------------------ plants

type PlantBucket = { form: PlantForm; matrices: Matrix4[]; ids: EntityId[] };

function bucketPlants(ctx: BuildContext): Map<string, PlantBucket> {
	const season = seasonOf(ctx.month);
	const buckets = new Map<string, PlantBucket>();
	const q = new Quaternion();
	const axis = new Vector3(0, 1, 0);

	for (const e of ctx.doc.entities) {
		if (e.k !== 'plant') continue;
		const sp = speciesOr(e.species);
		const age = Math.max(0, ctx.years - (e.plantedYear ?? 0));
		const size = sizeAt(sp, age, e.sizeJitter);
		if (size.h <= 0.01) continue;

		let bucket = buckets.get(sp.id);
		if (!bucket) {
			// One canonical form per species; per-plant variation rides on the instance matrix.
			const form = plantForm({ species: sp, sizeFactor: 1, season, month: ctx.month, seed: sp.id });
			bucket = { form, matrices: [], ids: [] };
			buckets.set(sp.id, bucket);
		}
		const sx = sp.mature.w > 0 ? size.w / sp.mature.w : 1;
		const sy = sp.mature.h > 0 ? size.h / sp.mature.h : 1;
		const m = new Matrix4();
		q.setFromAxisAngle(axis, e.rot ?? 0);
		m.compose(new Vector3(e.at.x, heightAt(ctx.field, e.at.x, e.at.y), -e.at.y), q, new Vector3(sx, sy, sx));
		bucket.matrices.push(m);
		bucket.ids.push(e.id);
	}
	return buckets;
}

/** A limb as a tapered length of wood, which is what a trunk and a branch both are. */
function limbGeometry(l: Limb): BufferGeometry {
	const dx = l.b.x - l.a.x;
	const dy = l.b.y - l.a.y;
	const dz = l.b.z - l.a.z;
	const len = Math.hypot(dx, dy, dz);
	if (len < 1e-5) return new BufferGeometry();
	const g = new CylinderGeometry(Math.max(l.rb, 0.0015), Math.max(l.ra, 0.0015), len, 6, 1, true);
	g.translate(0, len / 2, 0);
	const up = new Vector3(0, 1, 0);
	const dir = new Vector3(dx, dy, dz).normalize();
	g.applyQuaternion(new Quaternion().setFromUnitVectors(up, dir));
	g.translate(l.a.x, l.a.y, l.a.z);
	return g;
}

/** Every part of a plant in one geometry, its colour baked per vertex. */
function plantGeometry(form: PlantForm): BufferGeometry | null {
	const parts: BufferGeometry[] = [];
	const colours: string[] = [];
	for (const m of form.masses) {
		parts.push(massGeometry(m));
		colours.push(m.colour);
	}
	for (const l of form.limbs ?? []) {
		const g = limbGeometry(l);
		if (g.getAttribute('position')) {
			parts.push(g);
			colours.push(l.colour);
		}
	}
	if (!form.limbs && form.trunk) {
		const t = form.trunk;
		for (const stem of t.stems) {
			const g = unitCylinder.clone();
			g.scale(t.radius * 2, t.height, t.radius * 2);
			if (stem.lean) g.rotateZ(stem.lean);
			g.translate(stem.x, t.height / 2, stem.z);
			parts.push(g);
			colours.push(t.colour);
		}
	}
	if (parts.length === 0) return null;

	// Per part colour has to ride on the vertices, or a canopy shaded clump by clump would
	// need one mesh per shade and lose the instancing that keeps a thousand plants cheap.
	const c = new Color();
	parts.forEach((g, i) => {
		const count = g.getAttribute('position').count;
		const rgb = new Float32Array(count * 3);
		c.set(colours[i]);
		for (let v = 0; v < count; v++) {
			rgb[v * 3] = c.r;
			rgb[v * 3 + 1] = c.g;
			rgb[v * 3 + 2] = c.b;
		}
		g.setAttribute('color', new BufferAttribute(rgb, 3));
		if (!g.getAttribute('uv')) {
			g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
		}
	});
	const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
	if (parts.length > 1) for (const p of parts) p.dispose();
	if (!merged) return null;
	merged.computeVertexNormals();
	return merged;
}

function buildPlants(ctx: BuildContext): Object3D {
	const group = new Group();
	group.name = 'plants';
	for (const bucket of bucketPlants(ctx).values()) {
		if (bucket.matrices.length === 0) continue;
		const geometry = plantGeometry(bucket.form);
		if (!geometry) continue;
		const inst = new InstancedMesh(geometry, plantMaterial(), bucket.matrices.length);
		bucket.matrices.forEach((m, i) => inst.setMatrixAt(i, m));
		inst.instanceMatrix.needsUpdate = true;
		inst.castShadow = true;
		inst.receiveShadow = true;
		inst.userData.plantIds = bucket.ids;
		inst.frustumCulled = false;
		group.add(inst);
	}
	return group;
}

// ------------------------------------------------------------------- props

/**
 * The same colour on two touching parts merges them into one silhouette, which is what makes
 * a built object read as a lump. Each part gets a shade of its own and sits in a little of its
 * own shadow near the ground, so slats, staves and legs stay separate.
 */
function shadeParts(form: PropForm): { colour: string; opacity?: number; geometry: BufferGeometry }[] {
	const out: { colour: string; opacity?: number; geometry: BufferGeometry }[] = [];
	const c = new Color();
	form.parts.forEach((p, i) => {
		const g = partGeometry(p);
		const pos = g.getAttribute('position');
		const rgb = new Float32Array(pos.count * 3);
		c.set(p.colour);
		// A deterministic nudge per part, plus a darker foot, which reads as contact shadow.
		const jitter = (((i * 2654435761) % 1000) / 1000 - 0.5) * 0.07;
		for (let v = 0; v < pos.count; v++) {
			const y = pos.getY(v);
			const foot = Math.max(0, 1 - Math.max(0, y) / 0.35) * 0.16;
			const k = 1 + jitter - foot;
			rgb[v * 3] = c.r * k;
			rgb[v * 3 + 1] = c.g * k;
			rgb[v * 3 + 2] = c.b * k;
		}
		g.setAttribute('color', new BufferAttribute(rgb, 3));
		out.push({ colour: p.opacity !== undefined ? p.colour : 'vertex', opacity: p.opacity, geometry: g });
	});
	return out;
}

function buildProp(e: PropEntity, field: HeightField | null): Object3D | null {
	const form = formForProp(e);
	if (form.parts.length === 0) return null;
	const meshes = mergeByColour(shadeParts(form));
	if (meshes.length === 0) return null;
	const group = new Group();
	for (const m of meshes) group.add(m);
	// Level, and standing on the highest ground it covers, so no corner sinks in.
	const reach = 1.2 * (e.scale ?? 1);
	const under = groundUnder(field, [
		{ x: e.at.x - reach, y: e.at.y - reach },
		{ x: e.at.x + reach, y: e.at.y - reach },
		{ x: e.at.x + reach, y: e.at.y + reach },
		{ x: e.at.x - reach, y: e.at.y + reach }
	]);
	group.position.set(e.at.x, under.max, -e.at.y);
	group.rotation.y = e.rot ?? 0;
	const s = e.scale ?? 1;
	group.scale.setScalar(s);
	tagEntity(group, e.id);
	return group;
}

// ------------------------------------------------------------------- build

export type SceneParts = {
	ground: Group;
	surfaces: Group;
	structures: Group;
	planting: Group;
};

export function buildScene(ctx: BuildContext): SceneParts {
	const surfaces = new Group();
	surfaces.name = 'surfaces';
	let order = 1;
	for (const layer of ctx.doc.layers) {
		if (!layer.visible) continue;
		for (const e of ctx.doc.entities) {
			if (e.layer !== layer.id) continue;
			const s = buildSurface(e, ctx, order);
			if (s) {
				surfaces.add(s);
				order++;
			}
		}
	}

	const structures = new Group();
	structures.name = 'structures';
	structures.add(buildWalls(ctx.doc, ctx.field), buildRoofs(ctx.doc));
	for (const e of ctx.doc.entities) {
		if (!visible(ctx.doc, e)) continue;
		if (e.k === 'line') {
			const f = buildFence(e, ctx.field);
			if (f) structures.add(f);
		} else if (e.k === 'prop') {
			const p = buildProp(e, ctx.field);
			if (p) structures.add(p);
		}
	}

	const planting = new Group();
	planting.name = 'planting';
	planting.add(buildPlants(ctx));

	return { ground: buildGround(ctx.doc, ctx.field), surfaces, structures, planting };
}

function visible(doc: Doc, e: Entity): boolean {
	return doc.layers.find((l) => l.id === e.layer)?.visible !== false;
}

export function disposeObject(o: Object3D): void {
	o.traverse((c) => {
		const mesh = c as Mesh;
		if (mesh.geometry) mesh.geometry.dispose();
	});
	o.removeFromParent();
}

/** Rough count for the plant instancing budget, so the UI can warn before it crawls. */
export function plantCount(doc: Doc): number {
	return doc.entities.reduce((n, e) => n + (e.k === 'plant' ? 1 : 0), 0);
}

export type { PlantEntity };
