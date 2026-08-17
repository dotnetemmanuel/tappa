import {
	ACESFilmicToneMapping,
	Group,
	Object3D,
	PCFShadowMap,
	PerspectiveCamera,
	Raycaster,
	SRGBColorSpace,
	Scene,
	Texture,
	Vector2,
	Vector3,
	WebGLRenderer
} from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { docBounds } from '../core/doc/doc.js';
import type { Doc, EntityId } from '../core/doc/types.js';
import { rectCentre, type Rect } from '../core/geom/vec2.js';
import { buildScene, disposeObject, type BuildContext, type SceneParts } from './build.js';
import type { HeightField } from '../core/terrain/field.js';
import { SKY_SCALE, SunRig } from './sun.js';

export type CameraMode = 'orbit' | 'walk';

export type SceneOptions = {
	years: number;
	month: number;
	when: Date;
	/** The baked ground, rebuilt by the app and handed in so both views share one surface. */
	field?: HeightField | null;
	texture?: (assetId: string) => Texture | null;
};

const EYE_HEIGHT = 1.7;
const WALK_SPEED = 3.2;
const RUN_SPEED = 7;

/**
 * The 3D view. It owns the renderer and rebuilds from the document on demand;
 * the plan stays the authoring surface, so nothing here writes to the document
 * except the transform gizmo, which reports through `onMove`.
 */
export class PlanScene {
	readonly scene = new Scene();
	readonly camera: PerspectiveCamera;
	private readonly renderer: WebGLRenderer;
	private readonly controls: MapControls;
	private readonly sun: SunRig;
	private readonly root = new Group();
	private parts: SceneParts | null = null;
	private raf = 0;
	private lastFrame = 0;
	private mode: CameraMode = 'orbit';
	private keys = new Set<string>();
	private yaw = 0;
	private pitch = -0.15;
	private looking = false;
	private lastPointer = new Vector2();
	private options: SceneOptions;
	private doc: Doc;
	private disposed = false;

	onPick: ((id: EntityId | null, additive: boolean) => void) | null = null;

	constructor(canvas: HTMLCanvasElement, doc: Doc, options: SceneOptions) {
		this.doc = doc;
		this.options = options;

		this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
		this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = PCFShadowMap;
		this.renderer.outputColorSpace = SRGBColorSpace;
		this.renderer.toneMapping = ACESFilmicToneMapping;
		SunRig.configure(this.renderer);

		this.camera = new PerspectiveCamera(55, 1, 0.1, SKY_SCALE * 1.4);
		this.camera.position.set(18, 16, 22);

		this.scene.add(this.root);
		this.sun = new SunRig(this.scene);

		this.controls = new MapControls(this.camera, canvas);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
		this.controls.minDistance = 2;
		this.controls.maxDistance = 500;

		canvas.addEventListener('pointerdown', this.onPointerDown);
		canvas.addEventListener('pointermove', this.onPointerMove);
		canvas.addEventListener('pointerup', this.onPointerUp);
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);

		this.rebuild();
		this.frameAll();
		this.start();
	}

	// ------------------------------------------------------------- lifecycle

	private start(): void {
		const tick = (now: number) => {
			if (this.disposed) return;
			this.raf = requestAnimationFrame(tick);
			const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
			this.lastFrame = now;
			if (this.mode === 'walk') this.stepWalk(dt);
			else this.controls.update();
			this.sun.follow(this.camera.position.x, this.camera.position.y, this.camera.position.z);
			this.renderer.render(this.scene, this.camera);
		};
		this.raf = requestAnimationFrame(tick);
	}

	resize(w: number, h: number): void {
		if (w <= 0 || h <= 0) return;
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
	}

	dispose(): void {
		this.disposed = true;
		cancelAnimationFrame(this.raf);
		const canvas = this.renderer.domElement;
		canvas.removeEventListener('pointerdown', this.onPointerDown);
		canvas.removeEventListener('pointermove', this.onPointerMove);
		canvas.removeEventListener('pointerup', this.onPointerUp);
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		this.controls.dispose();
		this.sun.dispose();
		disposeObject(this.root);
		this.renderer.dispose();
	}

	// ---------------------------------------------------------------- update

	setDoc(doc: Doc): void {
		this.doc = doc;
		this.rebuild();
	}

	setOptions(o: Partial<SceneOptions>): void {
		const rebuildNeeded =
			(o.years !== undefined && o.years !== this.options.years) ||
			(o.month !== undefined && o.month !== this.options.month) ||
			(o.field !== undefined && o.field !== this.options.field);
		this.options = { ...this.options, ...o };
		if (rebuildNeeded) this.rebuild();
		else this.sun.update(this.doc, this.options.when);
	}

	/** Full rebuild. Cheap enough at this scale, and it cannot drift from the document. */
	rebuild(): void {
		if (this.parts) {
			disposeObject(this.parts.ground);
			disposeObject(this.parts.surfaces);
			disposeObject(this.parts.structures);
			disposeObject(this.parts.planting);
		}
		this.root.clear();
		const ctx: BuildContext = {
			doc: this.doc,
			field: this.options.field ?? null,
			years: this.options.years,
			month: this.options.month,
			texture: this.options.texture ?? (() => null)
		};
		this.parts = buildScene(ctx);
		this.root.add(this.parts.ground, this.parts.surfaces, this.parts.structures, this.parts.planting);
		this.sun.fitTo(this.boundsRect());
		this.sun.update(this.doc, this.options.when);
	}

	private boundsRect(): Rect {
		const b = docBounds(this.doc);
		if (!Number.isFinite(b.min.x) || b.max.x < b.min.x) {
			return { min: { x: -20, y: -20 }, max: { x: 20, y: 20 } };
		}
		return b;
	}

	// ---------------------------------------------------------------- camera

	setMode(mode: CameraMode): void {
		if (mode === this.mode) return;
		this.mode = mode;
		this.controls.enabled = mode === 'orbit';
		if (mode === 'walk') {
			// Start at the south edge looking in, rather than wherever the orbit camera
			// happened to be, which is usually inside the house.
			const b = this.boundsRect();
			const c = rectCentre(b);
			const span = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, 6);
			const stand = { x: c.x, z: -(b.min.y - Math.max(8, span * 0.8)) };
			this.camera.position.set(stand.x, EYE_HEIGHT, stand.z);
			this.yaw = Math.atan2(-(c.x - stand.x), -(-c.y - stand.z));
			this.pitch = -0.02;
			this.applyLook();
		} else {
			this.camera.position.y = Math.max(6, this.camera.position.y);
			const ahead = new Vector3(0, 0, -12).applyQuaternion(this.camera.quaternion);
			this.controls.target.copy(this.camera.position).add(ahead).setY(0);
			this.controls.update();
		}
	}

	get cameraMode(): CameraMode {
		return this.mode;
	}

	frameAll(): void {
		const b = this.boundsRect();
		const c = rectCentre(b);
		const span = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, 8);
		this.controls.target.set(c.x, 0, -c.y);
		this.camera.position.set(c.x + span * 0.55, span * 0.75, -c.y + span * 0.9);
		this.controls.update();
	}

	private applyLook(): void {
		this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
		this.camera.rotation.order = 'YXZ';
		this.camera.rotation.set(this.pitch, this.yaw, 0);
	}

	private stepWalk(dt: number): void {
		const speed = this.keys.has('shift') ? RUN_SPEED : WALK_SPEED;
		let f = 0;
		let s = 0;
		if (this.keys.has('w') || this.keys.has('arrowup')) f += 1;
		if (this.keys.has('s') || this.keys.has('arrowdown')) f -= 1;
		if (this.keys.has('d') || this.keys.has('arrowright')) s += 1;
		if (this.keys.has('a') || this.keys.has('arrowleft')) s -= 1;
		if (f === 0 && s === 0) return;
		const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		const move = forward.multiplyScalar(f).add(right.multiplyScalar(s)).normalize();
		this.camera.position.addScaledVector(move, speed * dt);
		this.camera.position.y = EYE_HEIGHT;
	}

	// -------------------------------------------------------------- pointing

	private onPointerDown = (ev: PointerEvent): void => {
		this.lastPointer.set(ev.clientX, ev.clientY);
		if (this.mode === 'walk' && ev.button === 0) {
			this.looking = true;
			(ev.target as HTMLElement).setPointerCapture(ev.pointerId);
		}
	};

	private onPointerMove = (ev: PointerEvent): void => {
		if (!this.looking) return;
		this.yaw -= (ev.clientX - this.lastPointer.x) * 0.004;
		this.pitch -= (ev.clientY - this.lastPointer.y) * 0.004;
		this.lastPointer.set(ev.clientX, ev.clientY);
		this.applyLook();
	};

	private onPointerUp = (ev: PointerEvent): void => {
		const wasLooking = this.looking;
		this.looking = false;
		const moved = Math.hypot(ev.clientX - this.lastPointer.x, ev.clientY - this.lastPointer.y);
		if (wasLooking || moved > 4 || !this.onPick) return;
		this.onPick(this.pickAt(ev), ev.shiftKey);
	};

	private pickAt(ev: PointerEvent): EntityId | null {
		const canvas = this.renderer.domElement;
		const r = canvas.getBoundingClientRect();
		const ndc = new Vector2(
			((ev.clientX - r.left) / r.width) * 2 - 1,
			-((ev.clientY - r.top) / r.height) * 2 + 1
		);
		const ray = new Raycaster();
		ray.setFromCamera(ndc, this.camera);
		const hits = ray.intersectObject(this.root, true);
		for (const hit of hits) {
			const id = idOf(hit.object, hit.instanceId);
			if (id) return id;
		}
		return null;
	}

	private onKeyDown = (ev: KeyboardEvent): void => {
		if (this.mode !== 'walk') return;
		const el = ev.target as HTMLElement | null;
		if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) return;
		this.keys.add(ev.key.toLowerCase());
	};

	private onKeyUp = (ev: KeyboardEvent): void => {
		this.keys.delete(ev.key.toLowerCase());
	};

	/**
	 * Render at export resolution and copy it out in the same task. The WebGL
	 * buffer is cleared once the frame is composited, so reading the canvas any
	 * later hands back a blank image.
	 */
	capture(scale = 2): HTMLCanvasElement {
		const gl = this.renderer.domElement;
		const w = gl.clientWidth || gl.width;
		const h = gl.clientHeight || gl.height;
		const ratio = this.renderer.getPixelRatio();
		this.renderer.setPixelRatio(Math.min(4, ratio * scale));
		this.renderer.setSize(w, h, false);
		this.renderer.render(this.scene, this.camera);

		const out = document.createElement('canvas');
		out.width = gl.width;
		out.height = gl.height;
		out.getContext('2d')?.drawImage(gl, 0, 0);

		this.renderer.setPixelRatio(ratio);
		this.renderer.setSize(w, h, false);
		this.renderer.render(this.scene, this.camera);
		return out;
	}
}

function idOf(o: Object3D, instanceId: number | undefined): EntityId | null {
	const plantIds = o.userData.plantIds as EntityId[] | undefined;
	if (plantIds && instanceId !== undefined) return plantIds[instanceId] ?? null;
	let node: Object3D | null = o;
	while (node) {
		const id = node.userData.entityId as EntityId | undefined;
		if (id) return id;
		node = node.parent;
	}
	return null;
}
