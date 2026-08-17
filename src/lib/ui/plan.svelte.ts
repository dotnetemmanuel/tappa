import {
	AddEntities,
	RemoveEntities,
	ReplaceEntities,
	SetPlotBoundary
} from '../core/cmd/edits.js';
import { anchorAt, offsetFromPoint } from '../core/doc/dimension.js';
import { applyCalibration as calibrateImage, measuredMetres } from '../io/calibrate.js';
import { findEntity, isEditable, setVertex, translateEntity } from '../core/doc/doc.js';
import {
	makeArea,
	makeDim,
	makeLabel,
	makeLine,
	makePath,
	makePlant,
	makeProp,
	makeSpot,
	makeWall
} from '../core/doc/factory.js';
import { heightAt, type HeightField } from '../core/terrain/field.js';
import { groundUnder } from '../core/terrain/query.js';
import { SetNodes } from '../core/cmd/edits.js';
import { newNodeId } from '../core/doc/doc.js';
import { rngFor } from '../core/rng.js';
import type { Anchor, Entity, EntityId, NodeId } from '../core/doc/types.js';
import { pick, pickInRect, pickPlot } from '../core/geom/hittest.js';
import { constrain, snap, type SnapResult } from '../core/geom/snap.js';
import { dedupe, simplify } from '../core/geom/polygon.js';
import { angle, dist, sub, type Vec2 } from '../core/geom/vec2.js';
import type { DraftShape } from '../render2d/painter.js';
import { panBy, toWorld, zoomAt } from '../render2d/view.js';
import type { AppState } from './app.svelte.js';

const PICK_PX = 9;
const IMAGE_KINDS: ReadonlySet<Entity['k']> = new Set(['image']);
const CLICK_SLOP_PX = 4;

type Chain = { t: 'chain'; kind: 'area' | 'path' | 'fence' | 'plot'; pts: Vec2[] };
/** Wall points remember the node they landed on, so a corner can be shared. */
type WallChain = { t: 'wall'; pts: Vec2[]; nodes: (NodeId | null)[] };
type Draft =
	| null
	| Chain
	| WallChain
	| { t: 'rect'; a: Vec2; b: Vec2 }
	| { t: 'freehand'; pts: Vec2[] }
	| { t: 'dim'; from: Anchor; fromAt: Vec2; to: Anchor | null; toAt: Vec2 | null; offset: number }
	| { t: 'calib'; image: EntityId; a: Vec2; b: Vec2 | null };

type Drag =
	| null
	| { d: 'pan'; last: Vec2 }
	| { d: 'marquee'; from: Vec2; crossing: boolean }
	| { d: 'move'; from: Vec2; originals: Entity[] }
	| { d: 'vertex'; id: EntityId; index: number; original: Entity }
	| { d: 'plotVertex'; index: number; original: Vec2[] }
	| { d: 'rect'; a: Vec2 }
	| { d: 'freehand' };

export type Hud = {
	visible: boolean;
	at: Vec2;
	length: string;
	angle: string;
	lengthLocked: boolean;
	angleLocked: boolean;
};

const emptyHud = (): Hud => ({
	visible: false,
	at: { x: 0, y: 0 },
	length: '',
	angle: '',
	lengthLocked: false,
	angleLocked: false
});

const parseNum = (s: string): number | null => {
	const n = Number(s.replace(',', '.').trim());
	return Number.isFinite(n) ? n : null;
};

const fmt = (n: number, dp: number): string => n.toFixed(dp).replace('.', ',');

const round2 = (n: number): number => Math.round(n * 100) / 100;

function defaultFloor(field: HeightField | null, ring: readonly Vec2[]): number {
	if (!field || ring.length < 3) return 0;
	return round2(groundUnder(field, ring).max);
}

/** Draft state is a reactive proxy; the document must only ever hold plain data. */
const plain = <T>(value: T): T => $state.snapshot(value) as T;

/**
 * Everything that happens on the plan surface: pointer handling, the draw
 * chain, and the numeric entry that makes a segment exactly 4,25 m long.
 */
export class PlanController {
	draft = $state<Draft>(null);
	snapResult = $state<SnapResult | null>(null);
	hover = $state<EntityId | null>(null);
	marquee = $state<{ a: Vec2; b: Vec2; crossing: boolean } | null>(null);
	hud = $state<Hud>(emptyHud());
	cursor = $state<Vec2>({ x: 0, y: 0 });

	/** Set while the user is drawing a known length over an image underlay. */
	calibrating = $state<EntityId | null>(null);
	calibLength = $state('');

	private drag: Drag = null;
	private downAt: Vec2 | null = null;
	private moved = false;
	private ortho = false;

	constructor(private readonly app: AppState) {}

	// ---------------------------------------------------------------- pointer

	pointerDown(ev: PointerEvent, el: HTMLElement): void {
		el.setPointerCapture(ev.pointerId);
		const screen = this.screenOf(ev, el);
		this.downAt = screen;
		this.moved = false;
		this.ortho = ev.shiftKey;
		const world = this.resolvePoint(screen);

		if (ev.button === 1 || this.app.tool === 'pan' || ev.altKey) {
			this.drag = { d: 'pan', last: screen };
			return;
		}
		if (ev.button !== 0) return;

		if (this.calibrating) {
			this.calibClick(world);
			return;
		}

		switch (this.app.tool) {
			case 'select':
				this.selectDown(screen, world, ev.shiftKey);
				break;
			case 'rect':
				this.drag = { d: 'rect', a: world };
				this.draft = { t: 'rect', a: world, b: world };
				break;
			case 'freehand':
				this.drag = { d: 'freehand' };
				this.draft = { t: 'freehand', pts: [world] };
				break;
			case 'polygon':
			case 'path':
			case 'fence':
			case 'plot':
				this.chainClick(world);
				break;
			case 'wall':
				this.wallClick(world);
				break;
			case 'plant': {
				const e = makePlant(world, this.app.activeSpecies, this.app.years, this.jitter());
				this.app.history.run(new AddEntities([e], 'Plantera'));
				this.app.select([e.id]);
				break;
			}
			case 'prop': {
				const e = makeProp(world, this.app.activeProp);
				this.app.history.run(new AddEntities([e], 'Föremål'));
				this.app.select([e.id]);
				break;
			}
			case 'spot': {
				// Starts at the ground already there, so the second point is a nudge rather than a guess.
				const e = makeSpot(world, round2(heightAt(this.app.field, world.x, world.y)));
				this.app.history.run(new AddEntities([e], 'Marknivå'));
				this.app.select([e.id]);
				break;
			}
			case 'image':
				this.imageClick(world);
				break;
			case 'dim':
				this.dimClick(world);
				break;
			case 'text': {
				const label = makeLabel(world, 'Text');
				this.app.history.run(new AddEntities([label], 'Text'));
				this.app.select([label.id]);
				this.app.setTool('select');
				break;
			}
		}
	}

	pointerMove(ev: PointerEvent, el: HTMLElement): void {
		const screen = this.screenOf(ev, el);
		this.ortho = ev.shiftKey;
		if (this.downAt && dist(this.downAt, screen) > CLICK_SLOP_PX) this.moved = true;

		if (this.drag?.d === 'pan') {
			this.app.view = panBy(this.app.view, sub(screen, this.drag.last));
			this.drag.last = screen;
			return;
		}

		const world = this.resolvePoint(screen);
		this.cursor = world;
		this.updateHud(screen);

		switch (this.drag?.d) {
			case 'marquee': {
				const crossing = world.x < this.drag.from.x;
				this.marquee = { a: this.drag.from, b: world, crossing };
				break;
			}
			case 'move': {
				const by = sub(world, this.drag.from);
				const moved = this.drag.originals.map((e) => translateEntity(e, by));
				this.app.history.coalesced(() =>
					this.app.history.run(new ReplaceEntities(moved, 'Flytta'))
				);
				break;
			}
			case 'vertex': {
				const next = setVertex(this.drag.original, this.drag.index, world);
				this.app.history.coalesced(() =>
					this.app.history.run(new ReplaceEntities([next], 'Flytta hörn'))
				);
				break;
			}
			case 'plotVertex': {
				const ring = this.drag.original.map((p, i) => (i === this.drag2Index() ? world : p));
				this.app.history.coalesced(() => this.app.history.run(new SetPlotBoundary(ring)));
				break;
			}
			case 'rect':
				this.draft = { t: 'rect', a: this.drag.a, b: world };
				break;
			case 'freehand':
				if (this.draft?.t === 'freehand') this.draft.pts.push(world);
				break;
			default:
				if (this.draft?.t === 'calib' && this.draft.b === null) this.cursor = world;
				else if (this.draft?.t === 'chain' || this.draft?.t === 'wall') this.previewChain(world);
				else if (this.draft?.t === 'dim') this.previewDim(world);
				else if (this.app.tool === 'select') this.updateHover(world);
		}
	}

	pointerUp(ev: PointerEvent, el: HTMLElement): void {
		if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
		const screen = this.screenOf(ev, el);
		const world = this.resolvePoint(screen);
		const d = this.drag;
		this.drag = null;
		this.downAt = null;
		this.app.history.endCoalescing();

		switch (d?.d) {
			case 'marquee': {
				if (this.marquee) {
					const r = {
						min: { x: Math.min(this.marquee.a.x, world.x), y: Math.min(this.marquee.a.y, world.y) },
						max: { x: Math.max(this.marquee.a.x, world.x), y: Math.max(this.marquee.a.y, world.y) }
					};
					const hits = pickInRect(this.app.doc, r, { crossing: this.marquee.crossing });
					if (ev.shiftKey) this.app.select([...this.app.selection, ...hits.map((h) => h.id)]);
					else this.app.select(hits.map((h) => h.id));
				}
				this.marquee = null;
				break;
			}
			case 'rect': {
				this.commitRect(d.a, world);
				break;
			}
			case 'freehand': {
				this.commitFreehand();
				break;
			}
			case 'move':
			case 'vertex':
			case 'plotVertex':
				break;
			default:
				if (!this.moved && this.app.tool === 'select' && !this.draft) {
					// A click that never became a drag and hit nothing clears the selection.
					const hit = pick(this.app.doc, world, { tolerance: this.tol() });
					if (!hit && !ev.shiftKey) this.app.clearSelection();
				}
		}
		this.moved = false;
	}

	wheel(ev: WheelEvent, el: HTMLElement): void {
		ev.preventDefault();
		const screen = this.screenOf(ev, el);
		const factor = Math.pow(0.999, ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY);
		this.app.view = zoomAt(this.app.view, screen, factor);
	}

	// ------------------------------------------------------------------- keys

	/** Returns true when the controller consumed the key. */
	keyDown(ev: KeyboardEvent): boolean {
		if (ev.key === 'Escape') {
			this.cancel();
			return true;
		}
		if (ev.key === 'Enter') {
			this.commitChain();
			this.commitWalls();
			return true;
		}
		if (ev.key === 'Backspace' && (this.draft?.t === 'chain' || this.draft?.t === 'wall')) {
			if (this.draft.pts.length > 1) {
				this.draft.pts.pop();
				if (this.draft.t === 'wall') this.draft.nodes.pop();
			} else this.cancel();
			return true;
		}
		return false;
	}

	cancel(): void {
		if (this.calibrating) {
			this.cancelCalibration();
			return;
		}
		if (this.draft) {
			this.draft = null;
			this.hud = emptyHud();
			return;
		}
		this.app.clearSelection();
	}

	deleteSelection(): void {
		if (this.app.selection.length === 0) return;
		this.app.history.run(new RemoveEntities([...this.app.selection]));
		this.app.clearSelection();
	}

	// ------------------------------------------------------------------- HUD

	/** The user typed into the length or angle field, so the point is pinned. */
	setHudLength(text: string): void {
		this.hud.length = text;
		this.hud.lengthLocked = text.trim() !== '';
	}

	setHudAngle(text: string): void {
		this.hud.angle = text;
		this.hud.angleLocked = text.trim() !== '';
	}

	/** Enter inside the HUD lays down the segment at exactly what was typed. */
	commitHud(): void {
		const from = this.chainLast();
		if (!from) return;
		const at = this.constrained(from, this.cursor);
		if (this.draft?.t === 'wall') {
			this.draft.pts.push(at);
			this.draft.nodes.push(null);
			this.hud.lengthLocked = false;
			this.hud.length = '';
		} else if (this.draft?.t === 'chain') {
			this.draft.pts.push(at);
			this.hud.lengthLocked = false;
			this.hud.length = '';
		} else if (this.drag?.d === 'rect') {
			this.commitRect(this.drag.a, at);
			this.drag = null;
		}
	}

	private updateHud(screen: Vec2): void {
		const from = this.chainLast();
		if (!from) {
			if (this.hud.visible) this.hud = emptyHud();
			return;
		}
		const to = this.constrained(from, this.cursor);
		this.hud.visible = true;
		this.hud.at = {
			x: Math.min(screen.x + 16, this.app.view.w - 200),
			y: Math.min(screen.y + 16, this.app.view.h - 48)
		};
		if (!this.hud.lengthLocked) this.hud.length = fmt(dist(from, to), 2);
		if (!this.hud.angleLocked) {
			const deg = ((angle(sub(to, from)) * 180) / Math.PI + 360) % 360;
			this.hud.angle = fmt(deg, 1);
		}
	}

	private constrained(from: Vec2, raw: Vec2): Vec2 {
		const length = this.hud.lengthLocked ? parseNum(this.hud.length) : null;
		const deg = this.hud.angleLocked ? parseNum(this.hud.angle) : null;
		if (length === null && deg === null) return raw;
		return constrain(from, raw, {
			length: length ?? undefined,
			angleRad: deg === null ? undefined : (deg * Math.PI) / 180
		});
	}

	// ----------------------------------------------------------------- tools

	private selectDown(screen: Vec2, world: Vec2, additive: boolean): void {
		const tol = this.tol();
		const selected = this.app.selectionSet;

		if (selected.size > 0) {
			const part = pick(this.app.doc, world, { tolerance: tol, only: selected });
			if (part?.part === 'vertex' && isEditable(this.app.doc, part.entity)) {
				this.drag = { d: 'vertex', id: part.entity.id, index: part.index, original: part.entity };
				return;
			}
		}
		if (this.app.doc.plot.boundary.length > 0) {
			const p = pickPlot(this.app.doc, world, tol);
			if (p?.part === 'vertex') {
				this.plotIndex = p.index;
				this.drag = { d: 'plotVertex', index: p.index, original: [...this.app.doc.plot.boundary] };
				return;
			}
		}

		const hit = pick(this.app.doc, world, { tolerance: tol });
		if (!hit) {
			if (!additive) this.app.clearSelection();
			this.drag = { d: 'marquee', from: world, crossing: false };
			this.marquee = { a: world, b: world, crossing: false };
			return;
		}
		if (additive) this.app.toggleSelect(hit.entity.id);
		else if (!selected.has(hit.entity.id)) this.app.select([hit.entity.id]);

		const originals = this.app.selection
			.map((id) => findEntity(this.app.doc, id))
			.filter((e): e is Entity => !!e && isEditable(this.app.doc, e));
		if (originals.length > 0) this.drag = { d: 'move', from: world, originals };
		void screen;
	}

	private plotIndex = 0;
	private drag2Index(): number {
		return this.plotIndex;
	}

	private chainClick(world: Vec2): void {
		const kind =
			this.app.tool === 'polygon'
				? 'area'
				: this.app.tool === 'path'
					? 'path'
					: this.app.tool === 'fence'
						? 'fence'
						: 'plot';
		if (this.draft?.t !== 'chain' || this.draft.kind !== kind) {
			this.draft = { t: 'chain', kind, pts: [world] };
			return;
		}
		const pts = this.draft.pts;
		const closes =
			(kind === 'area' || kind === 'plot') && pts.length >= 3 && dist(world, pts[0]) <= this.tol();
		if (closes) {
			this.commitChain();
			return;
		}
		if (dist(world, pts[pts.length - 1]) < 1e-6) return;
		pts.push(world);
		this.hud.lengthLocked = false;
		this.hud.length = '';
	}

	private previewChain(world: Vec2): void {
		const d = this.draft;
		if (d?.t !== 'chain' && d?.t !== 'wall') return;
		const from = d.pts[d.pts.length - 1];
		this.cursor = this.constrained(from, world);
	}

	private jitter(): number {
		return rngFor(`jitter-${this.app.doc.entities.length}-${Date.now()}`)() * 0.3 - 0.15;
	}

	/** A wall point reuses whatever node it snapped to, which is what shares a corner. */
	private wallClick(world: Vec2): void {
		const node = this.snapResult?.ref?.node ?? null;
		const d = this.draft;
		if (d?.t !== 'wall') {
			this.draft = { t: 'wall', pts: [world], nodes: [node] };
			return;
		}
		if (dist(world, d.pts[d.pts.length - 1]) < 1e-6) return;
		d.pts.push(world);
		d.nodes.push(node);
		this.hud.lengthLocked = false;
		this.hud.length = '';
	}

	private commitChain(): void {
		const d = plain(this.draft);
		if (d?.t !== 'chain') return;
		const pts = dedupe(d.pts, 1e-6, d.kind === 'area' || d.kind === 'plot');
		this.draft = null;
		this.hud = emptyHud();
		const app = this.app;

		if (d.kind === 'plot') {
			if (pts.length >= 3) app.history.run(new SetPlotBoundary(pts));
			return;
		}
		if (d.kind === 'area') {
			if (pts.length < 3) return;
			const e = makeArea(pts, app.activeMat);
			app.history.run(new AddEntities([e], 'Yta'));
			app.select([e.id]);
			return;
		}
		if (pts.length < 2) return;
		const e =
			d.kind === 'path'
				? makePath(pts, app.activeMat === 'lawn' ? 'gravel' : app.activeMat, app.pathWidth)
				: makeLine(pts, app.activeLineStyle, app.fenceHeight);
		app.history.run(new AddEntities([e], d.kind === 'path' ? 'Gång' : 'Linje'));
		app.select([e.id]);
	}

	private commitWalls(): void {
		const d = plain(this.draft);
		if (d?.t !== 'wall') return;
		this.draft = null;
		this.hud = emptyHud();
		if (d.pts.length < 2) return;

		const app = this.app;
		const tol = 1e-3;
		app.history.transact('Vägg', () => {
			const added: Record<NodeId, Vec2> = {};
			// Two clicks on the same spot must land on one node, or the loop never closes
			// and everything downstream of a closed loop, roofs above all, finds nothing.
			const nodeAt = (p: Vec2): NodeId | null => {
				for (const [id, q] of Object.entries(app.doc.nodes)) if (dist(p, q) <= tol) return id;
				for (const [id, q] of Object.entries(added)) if (dist(p, q) <= tol) return id;
				return null;
			};
			const ids = d.pts.map((p, i) => {
				const snapped = d.nodes[i];
				if (snapped && app.doc.nodes[snapped]) return snapped;
				const existing = nodeAt(p);
				if (existing) return existing;
				const id = newNodeId();
				added[id] = p;
				return id;
			});
			if (Object.keys(added).length > 0) app.history.run(new SetNodes(added));

			const walls = [];
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local dedupe set
			const seen = new Set<string>();
			for (let i = 1; i < ids.length; i++) {
				const a = ids[i - 1];
				const b = ids[i];
				if (a === b) continue;
				const key = a < b ? `${a}|${b}` : `${b}|${a}`;
				if (seen.has(key)) continue;
				seen.add(key);
				walls.push(makeWall(a, b, app.wallThickness, app.wallHeight));
			}
			if (walls.length === 0) return;
			// A suterrang house sits at the high side, so the uphill wall shows no base at all.
			const floor = defaultFloor(app.field, d.pts);
			if (floor !== 0) for (const w of walls) w.floor = floor;
			app.history.run(new AddEntities(walls, 'Vägg'));
			app.select(walls.map((w) => w.id));
		});
	}

	private commitRect(a: Vec2, b: Vec2): void {
		this.draft = null;
		this.hud = emptyHud();
		if (Math.abs(b.x - a.x) < 1e-4 || Math.abs(b.y - a.y) < 1e-4) return;
		const ring = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
		const e = makeArea(ring, this.app.activeMat);
		this.app.history.run(new AddEntities([e], 'Rektangel'));
		this.app.select([e.id]);
	}

	private commitFreehand(): void {
		const d = plain(this.draft);
		this.draft = null;
		if (d?.t !== 'freehand' || d.pts.length < 3) return;
		const tol = 3 / this.app.view.scale;
		const pts = dedupe(simplify(d.pts, tol), 1e-6, true);
		if (pts.length < 3) return;
		const e = makeArea(pts, this.app.activeMat);
		this.app.history.run(new AddEntities([e], 'Frihand'));
		this.app.select([e.id]);
	}

	startCalibration(imageId: EntityId): void {
		this.calibrating = imageId;
		this.draft = null;
		this.calibLength = '';
		this.app.status = 'Dra en linje över något du vet längden på, och skriv in måttet';
	}

	cancelCalibration(): void {
		this.calibrating = null;
		this.draft = null;
		this.calibLength = '';
	}

	private calibClick(world: Vec2): void {
		const d = this.draft;
		if (d?.t !== 'calib') {
			this.draft = { t: 'calib', image: this.calibrating ?? '', a: world, b: null };
			return;
		}
		if (d.b === null) {
			this.draft = { ...d, b: world };
			this.calibLength = measuredMetres({ a: d.a, b: world }).toFixed(2).replace('.', ',');
		}
	}

	/** The user typed the real length of the line they drew over the picture. */
	applyCalibration(): void {
		const d = plain(this.draft);
		if (d?.t !== 'calib' || !d.b) return;
		const real = parseNum(this.calibLength);
		const image = findEntity(this.app.doc, d.image);
		if (!real || real <= 0 || !image || image.k !== 'image') return;
		const transform = calibrateImage(image, { a: d.a, b: d.b, realMetres: real });
		this.app.history.run(new ReplaceEntities([{ ...image, transform }], 'Skala om bild'));
		this.cancelCalibration();
		this.app.status = 'Bilden är skalad';
	}

	/** The underlay layer is locked so it does not steal clicks, so this is the way back to it. */
	private imageClick(world: Vec2): void {
		const hit = pick(this.app.doc, world, {
			tolerance: this.tol(),
			respectLayers: false,
			kinds: IMAGE_KINDS
		});
		if (!hit) {
			this.app.status = 'Släpp en bildfil på ritningen, eller klistra in en med Ctrl+V';
			return;
		}
		this.app.select([hit.entity.id]);
		this.app.status = 'Bilden är vald. Sätt skalan, eller lås upp den för att flytta den.';
	}

	private dimClick(world: Vec2): void {
		const tol = this.tol();
		const d = plain(this.draft);
		if (d?.t !== 'dim') {
			const a = anchorAt(this.app.doc, world, tol);
			this.draft = { t: 'dim', from: a, fromAt: world, to: null, toAt: null, offset: 0 };
			return;
		}
		if (!d.to) {
			this.draft = { ...d, to: anchorAt(this.app.doc, world, tol), toAt: world };
			return;
		}
		const e = makeDim(d.from, d.to, d.offset);
		this.draft = null;
		this.app.history.run(new AddEntities([e], 'Mått'));
		this.app.select([e.id]);
	}

	private previewDim(world: Vec2): void {
		const d = this.draft;
		if (d?.t !== 'dim' || !d.toAt) return;
		d.offset = offsetFromPoint(d.fromAt, d.toAt, world);
	}

	// ------------------------------------------------------------- internals

	private updateHover(world: Vec2): void {
		const hit = pick(this.app.doc, world, { tolerance: this.tol() });
		this.hover = hit?.entity.id ?? null;
	}

	private tol(): number {
		return PICK_PX / this.app.view.scale;
	}

	private chainLast(): Vec2 | null {
		if (this.draft?.t === 'chain' || this.draft?.t === 'wall')
			return this.draft.pts[this.draft.pts.length - 1] ?? null;
		if (this.drag?.d === 'rect') return this.drag.a;
		return null;
	}

	private screenOf(ev: { clientX: number; clientY: number }, el: HTMLElement): Vec2 {
		const r = el.getBoundingClientRect();
		return { x: ev.clientX - r.left, y: ev.clientY - r.top };
	}

	/** Raw pointer position turned into a snapped world point. */
	private resolvePoint(screen: Vec2): Vec2 {
		const raw = toWorld(this.app.view, screen);
		const chain =
			this.draft?.t === 'chain' || this.draft?.t === 'wall' ? this.draft : null;
		const from = this.chainLast() ?? undefined;
		const prevDir =
			chain && chain.pts.length >= 2
				? sub(chain.pts[chain.pts.length - 1], chain.pts[chain.pts.length - 2])
				: undefined;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a read-only snapshot, never mutated
		const exclude = new Set(
			this.drag?.d === 'move'
				? this.drag.originals.map((e) => e.id)
				: this.drag?.d === 'vertex'
					? [this.drag.id]
					: []
		);
		const s = snap(
			this.app.doc,
			raw,
			{ from, prevDir, ortho: this.ortho, exclude, extra: chain?.pts },
			{ ...this.app.snapSettings, tolerance: PICK_PX / this.app.view.scale }
		);
		this.snapResult = s;
		return from ? this.constrained(from, s.at) : s.at;
	}

	// ------------------------------------------------------------- rendering

	get draftShape(): DraftShape | null {
		const d = this.draft;
		if (!d) return null;
		switch (d.t) {
			case 'wall': {
				const pts = [...d.pts, this.cursor];
				return { d: 'polyline', pts, width: this.app.wallThickness };
			}
			case 'chain': {
				const pts = [...d.pts, this.cursor];
				return d.kind === 'area' || d.kind === 'plot'
					? { d: 'ring', pts, closing: pts.length > 2 }
					: {
							d: 'polyline',
							pts,
							width: d.kind === 'path' ? this.app.pathWidth : undefined
						};
			}
			case 'rect':
				return { d: 'rect', a: d.a, b: d.b };
			case 'freehand':
				return { d: 'polyline', pts: d.pts };
			case 'calib':
				return d.b
					? { d: 'dim', a: d.a, b: d.b, offset: 0 }
					: { d: 'polyline', pts: [d.a, this.cursor], colour: '#c8631f' };
			case 'dim':
				return d.toAt
					? { d: 'dim', a: d.fromAt, b: d.toAt, offset: d.offset }
					: { d: 'point', at: d.fromAt };
		}
	}

	nudge(by: Vec2): void {
		const originals = this.app.selection
			.map((id) => findEntity(this.app.doc, id))
			.filter((e): e is Entity => !!e && isEditable(this.app.doc, e));
		if (originals.length === 0) return;
		this.app.history.run(
			new ReplaceEntities(
				originals.map((e) => translateEntity(e, by)),
				'Flytta'
			)
		);
	}

}
