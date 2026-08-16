import {
	BoxGeometry,
	BufferGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	DoubleSide,
	Group,
	InstancedMesh,
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
import { wallSolid } from '../core/building/wallgraph.js';
import { docBounds } from '../core/doc/doc.js';
import { lineStyle } from '../core/doc/materials.js';
import type { Doc, Entity, EntityId, LineEntity, PlantEntity, PropEntity } from '../core/doc/types.js';
import { strokeToRing } from '../core/geom/polygon.js';
import type { Vec2 } from '../core/geom/vec2.js';
import { speciesOr } from '../core/plants/catalog.js';
import { seasonOf, sizeAt } from '../core/plants/growth.js';
import { plantForm } from '../core/plants/archetypes.js';
import type { Mass, PlantForm } from '../core/plants/types.js';
import { formForProp } from '../core/props/builders.js';
import type { Part } from '../core/props/types.js';
import { colourMaterial, glassMaterial, surfaceMaterial } from './materials.js';
import { prismToGeometry, ribbonToGeometry, ringToGeometry, solidToGeometry } from './geometry.js';

/** Surfaces are lifted a few millimetres apart so co-planar areas do not z-fight. */
const LAYER_LIFT = 0.004;

export type BuildContext = {
	doc: Doc;
	/** Global years since planting, from the age slider. */
	years: number;
	/** Month 1 to 12, drives season, bloom and dieback. */
	month: number;
	texture: (assetId: string) => import('three').Texture | null;
};

const unitSphere = new SphereGeometry(0.5, 14, 10);
const unitCone = new ConeGeometry(0.5, 1, 14);
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
		const mat = colourMaterial(g.colour, { rough: 0.85 });
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
export function buildGround(doc: Doc): Group {
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
	const terrain = new Mesh(
		new PlaneGeometry(span, span).rotateX(-Math.PI / 2),
		colourMaterial('#6f7f52', { rough: 1 })
	);
	terrain.position.set(centre.x, -0.02, -centre.y);
	terrain.receiveShadow = true;
	terrain.name = 'terrain';

	if (doc.plot.boundary.length >= 3) {
		const g = ringToGeometry(doc.plot.boundary, [], -0.005);
		if (g) {
			const plot = new Mesh(g, colourMaterial('#7d8f5c', { rough: 1 }));
			plot.receiveShadow = true;
			plot.name = 'plot';
			group.add(plot);
		}
	}
	group.add(terrain);
	return group;
}

function buildSurface(e: Entity, ctx: BuildContext, order: number): Object3D | null {
	if (e.k !== 'area' && e.k !== 'path') return null;
	const ring = e.k === 'area' ? e.ring : e.spine.length >= 2 ? strokeToRing(e.spine, e.width) : null;
	if (!ring || ring.length < 3) return null;
	const elev = (e.k === 'area' ? (e.elev ?? 0) : 0) + order * LAYER_LIFT;
	const holes = e.k === 'area' ? (e.holes ?? []) : [];
	const g = ringToGeometry(ring, holes, elev);
	if (!g) return null;
	const mesh = new Mesh(g, surfaceMaterial(e.mat, e.mat.asset ? ctx.texture(e.mat.asset) : null));
	mesh.receiveShadow = true;
	tagEntity(mesh, e.id);
	return mesh;
}

// -------------------------------------------------------------- structures

function buildFence(e: LineEntity): Object3D | null {
	if (e.spine.length < 2) return null;
	const def = lineStyle(e.style.id);
	const colour = e.style.colour ?? def.colour;
	const group = new Group();

	if (def.render === 'hedge' || def.render === 'stone') {
		const ring = strokeToRing(e.spine, Math.max(0.2, e.thickness));
		const g = prismToGeometry(ring, 0, e.height);
		if (g) {
			const mesh = new Mesh(g, colourMaterial(colour, { rough: 1, flat: def.render === 'stone' }));
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add(mesh);
		}
	} else if (def.render === 'solid' || def.render === 'panel') {
		const g = ribbonToGeometry(e.spine, e.height * (def.render === 'panel' ? 0.92 : 1), 0.02);
		if (g) {
			const mesh = new Mesh(g, panelMaterial(colour));
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add(mesh);
		}
		addPosts(group, e.spine, e.height, colour, 2.2);
	} else if (def.render === 'mesh' || def.render === 'trellis') {
		const g = ribbonToGeometry(e.spine, e.height, 0.05);
		if (g) {
			const mat = panelMaterial(colour);
			const see = transparentOf(mat, def.render === 'mesh' ? 0.35 : 0.5);
			group.add(new Mesh(g, see));
		}
		addPosts(group, e.spine, e.height, colour, 2.5);
	} else {
		addPickets(group, e.spine, e.height, colour);
		addPosts(group, e.spine, e.height, colour, 2);
	}
	tagEntity(group, e.id);
	return group.children.length > 0 ? group : null;
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

function addPosts(group: Group, spine: readonly Vec2[], height: number, colour: string, step: number): void {
	const parts: BufferGeometry[] = [];
	walkSpine(spine, step, (p) => {
		const g = unitBox.clone();
		g.scale(0.09, height + 0.08, 0.09);
		g.translate(p.x, (height + 0.08) / 2, -p.y);
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

function addPickets(group: Group, spine: readonly Vec2[], height: number, colour: string): void {
	const parts: BufferGeometry[] = [];
	walkSpine(spine, 0.12, (p, dir) => {
		const g = unitBox.clone();
		g.scale(0.035, height, 0.02);
		g.rotateY(Math.atan2(dir.x, dir.y) - Math.PI / 2);
		g.translate(p.x, height / 2, -p.y);
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

function buildWalls(doc: Doc): Object3D {
	const group = new Group();
	group.name = 'walls';
	for (const e of doc.entities) {
		if (e.k !== 'wall') continue;
		const solid = wallSolid(doc, e);
		if (solid.indices.length === 0) continue;
		const mesh = new Mesh(solidToGeometry(solid), colourMaterial('#d9d3c6', { rough: 0.95 }));
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		tagEntity(mesh, e.id);
		group.add(mesh);

		for (const p of placements(doc, e)) {
			const glass = new Mesh(unitPlane.clone(), glassMaterial());
			glass.scale.set(p.width, p.height, 1);
			glass.position.set(p.centre.x, p.sill + p.height / 2, -p.centre.y);
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
		const mesh = new Mesh(solidToGeometry(built.solid), colourMaterial('#5a5550', { rough: 0.95 }));
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
		m.compose(new Vector3(e.at.x, 0, -e.at.y), q, new Vector3(sx, sy, sx));
		bucket.matrices.push(m);
		bucket.ids.push(e.id);
	}
	return buckets;
}

function buildPlants(ctx: BuildContext): Object3D {
	const group = new Group();
	group.name = 'plants';
	for (const bucket of bucketPlants(ctx).values()) {
		if (bucket.matrices.length === 0) continue;
		const byColour = new Map<string, BufferGeometry[]>();
		for (const m of bucket.form.masses) {
			const list = byColour.get(m.colour) ?? [];
			list.push(massGeometry(m));
			byColour.set(m.colour, list);
		}
		if (bucket.form.trunk) {
			const t = bucket.form.trunk;
			for (const stem of t.stems) {
				const g = unitCylinder.clone();
				g.scale(t.radius * 2, t.height, t.radius * 2);
				if (stem.lean) g.rotateZ(stem.lean);
				g.translate(stem.x, t.height / 2, stem.z);
				const list = byColour.get(t.colour) ?? [];
				list.push(g);
				byColour.set(t.colour, list);
			}
		}

		for (const [colour, parts] of byColour) {
			const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
			if (!merged) continue;
			merged.computeVertexNormals();
			const inst = new InstancedMesh(
				merged,
				colourMaterial(colour, { rough: 1 }),
				bucket.matrices.length
			);
			bucket.matrices.forEach((m, i) => inst.setMatrixAt(i, m));
			inst.instanceMatrix.needsUpdate = true;
			inst.castShadow = true;
			inst.receiveShadow = true;
			inst.userData.plantIds = bucket.ids;
			inst.frustumCulled = false;
			group.add(inst);
			if (parts.length > 1) for (const p of parts) p.dispose();
		}
	}
	return group;
}

// ------------------------------------------------------------------- props

function buildProp(e: PropEntity): Object3D | null {
	const form = formForProp(e);
	if (form.parts.length === 0) return null;
	const meshes = mergeByColour(
		form.parts.map((p) => ({ colour: p.colour, opacity: p.opacity, geometry: partGeometry(p) }))
	);
	if (meshes.length === 0) return null;
	const group = new Group();
	for (const m of meshes) group.add(m);
	group.position.set(e.at.x, 0, -e.at.y);
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
	structures.add(buildWalls(ctx.doc), buildRoofs(ctx.doc));
	for (const e of ctx.doc.entities) {
		if (!visible(ctx.doc, e)) continue;
		if (e.k === 'line') {
			const f = buildFence(e);
			if (f) structures.add(f);
		} else if (e.k === 'prop') {
			const p = buildProp(e);
			if (p) structures.add(p);
		}
	}

	const planting = new Group();
	planting.name = 'planting';
	planting.add(buildPlants(ctx));

	return { ground: buildGround(ctx.doc), surfaces, structures, planting };
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
