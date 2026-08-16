import {
	AmbientLight,
	Color,
	DirectionalLight,
	HemisphereLight,
	Scene,
	type WebGLRenderer
} from 'three';
import { GradientSky, SKY_RADIUS } from './sky.js';
import type { Rect } from '../core/geom/vec2.js';
import { sunAt, sunLight } from '../core/sun/position.js';
import type { Doc } from '../core/doc/types.js';

const SHADOW_MAP = 2048;
export const SKY_SCALE = SKY_RADIUS;
/** suncalc gives physical intensity; these lift it to something the tone mapper likes. */
const SUN_GAIN = 2.8;
const AMBIENT_GAIN = 1.6;

/**
 * Sun, sky and ambient fill, all driven from one date. The shadow camera is
 * refitted to the plot rather than left at a default, or a 40 m garden gets
 * shadow acne at one end and nothing at the other.
 */
export class SunRig {
	readonly light: DirectionalLight;
	readonly hemi: HemisphereLight;
	readonly ambient: AmbientLight;
	readonly sky: GradientSky;
	private radius = 40;

	constructor(private readonly scene: Scene) {
		this.light = new DirectionalLight(0xfff2dd, 2.4);
		this.light.castShadow = true;
		this.light.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
		this.light.shadow.bias = -0.0006;
		this.light.shadow.normalBias = 0.03;
		this.light.target.position.set(0, 0, 0);
		scene.add(this.light);
		scene.add(this.light.target);

		this.hemi = new HemisphereLight(0xbcd6ea, 0x5d6b4c, 0.55);
		scene.add(this.hemi);

		this.ambient = new AmbientLight(0xffffff, 0.15);
		scene.add(this.ambient);

		this.sky = new GradientSky(scene);
	}

	/** Refit the shadow frustum to the ground the plan actually occupies. */
	fitTo(bounds: Rect): void {
		if (!Number.isFinite(bounds.min.x) || bounds.max.x < bounds.min.x) return;
		const w = bounds.max.x - bounds.min.x;
		const h = bounds.max.y - bounds.min.y;
		this.radius = Math.max(12, Math.hypot(w, h) / 2 + 8);
		const cx = (bounds.min.x + bounds.max.x) / 2;
		const cy = (bounds.min.y + bounds.max.y) / 2;
		this.light.target.position.set(cx, 0, -cy);
		this.light.target.updateMatrixWorld();

		const cam = this.light.shadow.camera;
		cam.left = -this.radius;
		cam.right = this.radius;
		cam.top = this.radius;
		cam.bottom = -this.radius;
		cam.near = 0.5;
		cam.far = this.radius * 4 + 60;
		cam.updateProjectionMatrix();
	}

	update(doc: Doc, when: Date): void {
		const p = sunAt(doc, when);
		const light = sunLight(p);
		const t = this.light.target.position;
		const d = this.radius * 2;
		this.light.position.set(
			t.x + p.toSun[0] * d,
			Math.max(0.5, t.y + p.toSun[1] * d),
			t.z + p.toSun[2] * d
		);
		this.light.color.set(light.colour);
		this.light.intensity = p.up ? light.intensity * SUN_GAIN : 0;
		this.light.castShadow = p.up && p.altitude > 0.03;
		this.ambient.intensity = light.ambient * AMBIENT_GAIN;
		this.hemi.intensity = 0.35 + light.ambient * AMBIENT_GAIN;

		this.sky.update(p.altitude, p.toSun, light.colour);
	}

	/** The gradient sky is not tone mapped, so this only has to suit the lit geometry. */
	static configure(renderer: WebGLRenderer): void {
		renderer.toneMappingExposure = 1;
	}

	/** Keep the dome centred on the camera so it never clips at the far plane. */
	follow(x: number, y: number, z: number): void {
		this.sky.follow(x, y, z);
	}

	dispose(): void {
		this.sky.dispose();
		this.scene.remove(this.light, this.light.target, this.hemi, this.ambient);
		this.light.dispose();
		this.hemi.dispose();
		this.ambient.dispose();
	}

	static skyColour(altitude: number): Color {
		const t = Math.max(0, Math.min(1, (altitude + 0.1) / 0.6));
		return new Color().lerpColors(new Color('#2a3340'), new Color('#8db6d8'), t);
	}
}
