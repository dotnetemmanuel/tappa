import type { Vec2 } from '../core/geom/vec2.js';

export type CompassStyle = {
	/** The needle's north half, and the letters. */
	ink: string;
	/** The ring, the south half and the minor points. */
	faint: string;
	/** Behind the rose, so it stays readable over a drawing or a photo. */
	backing?: string;
};

/**
 * One rose, drawn twice: on the plan where north is fixed by the plot's north offset, and
 * over the 3D view where it turns with the camera. `up` is the screen direction north points
 * in, in radians clockwise from straight up.
 */
export function drawCompass(
	ctx: CanvasRenderingContext2D,
	at: Vec2,
	radius: number,
	up: number,
	style: CompassStyle
): void {
	ctx.save();
	ctx.translate(at.x, at.y);

	if (style.backing) {
		ctx.beginPath();
		ctx.arc(0, 0, radius * 1.55, 0, Math.PI * 2);
		ctx.fillStyle = style.backing;
		ctx.fill();
	}

	ctx.rotate(up);

	ctx.beginPath();
	ctx.arc(0, 0, radius, 0, Math.PI * 2);
	ctx.strokeStyle = style.faint;
	ctx.lineWidth = 1;
	ctx.stroke();

	// A filled north half and a hollow south half, which is how a drafting rose reads at a glance.
	const half = radius * 0.34;
	ctx.beginPath();
	ctx.moveTo(0, -radius);
	ctx.lineTo(half, 0);
	ctx.lineTo(0, radius * 0.18);
	ctx.closePath();
	ctx.fillStyle = style.ink;
	ctx.fill();

	ctx.beginPath();
	ctx.moveTo(0, -radius);
	ctx.lineTo(-half, 0);
	ctx.lineTo(0, radius * 0.18);
	ctx.closePath();
	ctx.strokeStyle = style.ink;
	ctx.lineWidth = 1;
	ctx.stroke();

	ctx.beginPath();
	for (const [x, y] of [
		[radius * 0.72, 0],
		[-radius * 0.72, 0],
		[0, radius * 0.72]
	]) {
		ctx.moveTo(0, 0);
		ctx.lineTo(x, y);
	}
	ctx.strokeStyle = style.faint;
	ctx.stroke();

	ctx.font = `${Math.max(10, Math.round(radius * 0.46))}px Archivo, system-ui, sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const letter = (text: string, x: number, y: number, strong: boolean): void => {
		ctx.save();
		ctx.translate(x, y);
		// The letters stay upright however the rose is turned, or they read upside down.
		ctx.rotate(-up);
		ctx.fillStyle = strong ? style.ink : style.faint;
		ctx.fillText(text, 0, 0);
		ctx.restore();
	};
	const out = radius + Math.max(7, radius * 0.3);
	letter('N', 0, -out, true);
	letter('S', 0, out, false);
	letter('Ö', out, 0, false);
	letter('V', -out, 0, false);

	ctx.restore();
}
