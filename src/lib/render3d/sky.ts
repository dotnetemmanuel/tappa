import {
	BackSide,
	Color,
	Mesh,
	ShaderMaterial,
	SphereGeometry,
	Vector3,
	type Scene
} from 'three';

export const SKY_RADIUS = 1600;

/**
 * A vertical gradient sky driven by sun altitude, in place of the three.js Sky
 * addon: that shader washes out to white in this version, and a garden planner
 * needs a dependable horizon more than it needs physical scattering.
 */
const VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform vec3 sunColour;
varying vec3 vDir;

void main() {
  vec3 dir = normalize(vDir);
  float h = dir.y;
  // Tighten the gradient near the horizon so the band does not smear up the dome.
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 sky = mix(horizon, zenith, t);
  // GLSL smoothstep needs edge0 < edge1, so the below-horizon fade is inverted rather than reversed.
  sky = mix(sky, ground, 1.0 - smoothstep(-0.10, 0.0, h));

  // A soft glow around the sun, strongest when it sits low.
  float d = max(dot(dir, normalize(sunDir)), 0.0);
  float glow = pow(d, 220.0) * 0.9 + pow(d, 8.0) * 0.16;
  sky += sunColour * glow * clamp(1.0 - abs(h) * 0.5, 0.0, 1.0);

  gl_FragColor = vec4(sky, 1.0);
}
`;

type Uniforms = {
	zenith: { value: Color };
	horizon: { value: Color };
	ground: { value: Color };
	sunDir: { value: Vector3 };
	sunColour: { value: Color };
};

const DAY_ZENITH = new Color('#2f6ea8');
const DAY_HORIZON = new Color('#cfe0ea');
const DUSK_ZENITH = new Color('#3a4a72');
const DUSK_HORIZON = new Color('#e0a067');
const NIGHT_ZENITH = new Color('#101a2c');
const NIGHT_HORIZON = new Color('#1e2a3a');
const GROUND_HAZE = new Color('#6a7a52');

export class GradientSky {
	readonly mesh: Mesh;
	private readonly uniforms: Uniforms;

	constructor(scene: Scene) {
		this.uniforms = {
			zenith: { value: DAY_ZENITH.clone() },
			horizon: { value: DAY_HORIZON.clone() },
			ground: { value: GROUND_HAZE.clone() },
			sunDir: { value: new Vector3(0, 1, 0) },
			sunColour: { value: new Color('#ffd9a0') }
		};
		const material = new ShaderMaterial({
			uniforms: this.uniforms,
			vertexShader: VERT,
			fragmentShader: FRAG,
			side: BackSide,
			depthWrite: false,
			toneMapped: false
		});
		this.mesh = new Mesh(new SphereGeometry(SKY_RADIUS, 32, 16), material);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = -1;
		this.mesh.name = 'sky';
		scene.add(this.mesh);
	}

	/** `altitude` in radians, `toSun` a unit vector in scene space. */
	update(altitude: number, toSun: readonly [number, number, number], colour: string): void {
		const day = smoothstep(0.02, 0.35, altitude);
		const dusk = smoothstep(-0.22, 0.06, altitude);

		this.uniforms.zenith.value.copy(NIGHT_ZENITH).lerp(DUSK_ZENITH, dusk).lerp(DAY_ZENITH, day);
		this.uniforms.horizon.value
			.copy(NIGHT_HORIZON)
			.lerp(DUSK_HORIZON, dusk)
			.lerp(DAY_HORIZON, day);
		this.uniforms.sunDir.value.set(toSun[0], toSun[1], toSun[2]);
		this.uniforms.sunColour.value.set(colour);
	}

	/** Follows the camera so the dome never clips at the far plane. */
	follow(x: number, y: number, z: number): void {
		this.mesh.position.set(x, y, z);
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		(this.mesh.material as ShaderMaterial).dispose();
		this.mesh.removeFromParent();
	}
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}
