import { History } from '../core/cmd/history.js';
import { createDoc, docBounds } from '../core/doc/doc.js';
import type { Doc, EntityId, LineStyleId, MaterialId } from '../core/doc/types.js';
import { defaultSnapSettings, type SnapSettings } from '../core/geom/snap.js';
import type { ShadowGrid } from '../core/sun/shadow.js';
import type { PropId, SpeciesId } from '../core/doc/types.js';
import { createView, fitTo, type View } from '../render2d/view.js';

export type ToolId =
	| 'select'
	| 'pan'
	| 'plot'
	| 'rect'
	| 'polygon'
	| 'freehand'
	| 'path'
	| 'fence'
	| 'wall'
	| 'plant'
	| 'prop'
	| 'image'
	| 'dim'
	| 'text';

export const TOOLS: readonly { id: ToolId; sv: string; key: string; hint: string }[] = [
	{ id: 'select', sv: 'Välj', key: 'v', hint: 'Klicka för att välja, dra för att flytta' },
	{ id: 'pan', sv: 'Panorera', key: 'h', hint: 'Dra för att flytta vyn' },
	{ id: 'plot', sv: 'Tomtgräns', key: 'b', hint: 'Klicka ut tomtgränsen, Enter avslutar' },
	{ id: 'rect', sv: 'Rektangel', key: 'r', hint: 'Dra en yta, skriv mått och tryck Enter' },
	{
		id: 'polygon',
		sv: 'Yta',
		key: 'a',
		hint: 'Klicka ut en yta, klicka första punkten för att sluta'
	},
	{ id: 'freehand', sv: 'Frihand', key: 'f', hint: 'Dra en form, den förenklas när du släpper' },
	{ id: 'path', sv: 'Gång', key: 'g', hint: 'Klicka ut en gång, Enter avslutar' },
	{ id: 'fence', sv: 'Staket och häck', key: 's', hint: 'Klicka ut en linje, Enter avslutar' },
	{ id: 'dim', sv: 'Mått', key: 'm', hint: 'Klicka två punkter, dra ut måttlinjen' },
	{ id: 'wall', sv: 'Vägg', key: 'w', hint: 'Klicka ut väggarna, Enter avslutar. Hörn delas mellan väggar' },
	{ id: 'plant', sv: 'Växt', key: 'p', hint: 'Klicka för att plantera, dra längs en linje för en rad' },
	{ id: 'prop', sv: 'Föremål', key: 'o', hint: 'Klicka för att placera' },
	{ id: 'image', sv: 'Bild', key: 'i', hint: 'Släpp en bild på ritningen, eller klistra in den' },
	{ id: 'text', sv: 'Text', key: 't', hint: 'Klicka där texten ska stå' }
];

export type ViewMode = 'plan' | 'split' | 'scene';

/**
 * The single source of truth the whole UI reads. The document itself is a plain
 * object outside the rune graph: it is too big to proxy, so edits announce
 * themselves through `rev` instead.
 */
export class AppState {
	history: History;
	rev = $state(0);
	view = $state<View>(createView());
	selection = $state<EntityId[]>([]);
	tool = $state<ToolId>('select');
	snapSettings = $state<SnapSettings>(defaultSnapSettings());
	showGrid = $state(true);
	showVertices = $state(true);
	activeMat = $state<MaterialId>('lawn');
	activeLineStyle = $state<LineStyleId>('hack');
	pathWidth = $state(1.2);
	fenceHeight = $state(1.4);
	status = $state('');
	viewMode = $state<ViewMode>('plan');
	/** Years since planting for the whole garden, 0 to 30. */
	years = $state(0);
	// Always replaced wholesale by setWhen, never mutated in place, so a plain Date stays reactive.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	when = $state<Date>(new Date(2026, 5, 21, 15, 0, 0));
	activeSpecies = $state<SpeciesId>('bjork');
	activeProp = $state<PropId>('bench');
	wallThickness = $state(0.25);
	wallHeight = $state(2.5);
	shadow = $state<ShadowGrid | null>(null);
	showShadow = $state(false);
	shadowBusy = $state(false);
	showChecks = $state(true);
	projectId = $state('');
	/** Set by the 3D view so exports can grab the current frame. */
	sceneCanvas = $state<HTMLCanvasElement | null>(null);
	dirty = $state(false);
	/** Bumped whenever the undo stack changes, so buttons re-evaluate. */
	historyRev = $state(0);

	constructor(doc: Doc = createDoc()) {
		this.history = new History(doc);
		this.history.subscribe(() => {
			this.rev++;
			this.historyRev++;
			this.dirty = true;
		});
	}

	get doc(): Doc {
		return this.history.doc;
	}

	get canUndo(): boolean {
		void this.historyRev;
		return this.history.canUndo;
	}

	get canRedo(): boolean {
		void this.historyRev;
		return this.history.canRedo;
	}

	get month(): number {
		return this.when.getMonth() + 1;
	}

	setWhen(next: Date): void {
		this.when = next;
		// A different day invalidates a shadow study computed for the old one.
		this.shadow = null;
	}

	get selectionSet(): ReadonlySet<EntityId> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a read-only snapshot, never mutated
		return new Set(this.selection);
	}

	select(ids: EntityId[]): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- deduping a plain array
		this.selection = [...new Set(ids)];
	}

	toggleSelect(id: EntityId): void {
		this.selection = this.selection.includes(id)
			? this.selection.filter((x) => x !== id)
			: [...this.selection, id];
	}

	clearSelection(): void {
		this.selection = [];
	}

	setTool(t: ToolId): void {
		this.tool = t;
		this.status = TOOLS.find((x) => x.id === t)?.hint ?? '';
	}

	undo(): void {
		this.history.undo();
		this.pruneSelection();
	}

	redo(): void {
		this.history.redo();
		this.pruneSelection();
	}

	/** Undo can delete what was selected, so selection follows the document. */
	pruneSelection(): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a read-only snapshot, never mutated
		const live = new Set(this.doc.entities.map((e) => e.id));
		this.selection = this.selection.filter((id) => live.has(id));
	}

	loadDoc(doc: Doc): void {
		this.history.reset(doc);
		this.selection = [];
		this.rev++;
		this.historyRev++;
		this.dirty = false;
		this.zoomToFit();
	}

	/** Set when a fit was asked for before the canvas had a size to fit into. */
	pendingFit = false;

	zoomToFit(): void {
		if (this.view.w <= 1 || this.view.h <= 1) {
			this.pendingFit = true;
			return;
		}
		this.pendingFit = false;
		const b = docBounds(this.doc);
		if (!Number.isFinite(b.min.x) || b.max.x < b.min.x) {
			this.view = { ...createView(this.view.w, this.view.h) };
			return;
		}
		this.view = fitTo(this.view, b);
	}
}
