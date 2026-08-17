<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { AddEntities, ReplaceEntities } from '../core/cmd/edits.js';
	import { findEntity } from '../core/doc/doc.js';
	import type { Entity, EntityId } from '../core/doc/types.js';
	import {
		ghostAt,
		groundEdit,
		type GroundEdit,
		type GroundMove,
		type GroundTarget
	} from '../core/terrain/edit.js';
	import {
		elevationBounds,
		handleAt,
		FACING_SV,
		type Facing,
		type SlopeHandle
	} from '../core/terrain/section.js';
	import { aimAt, paintElevation } from '../render2d/elevation.js';
	import { PLAN } from '../render2d/theme.js';
	import { createView, fitTo, panBy, toScreen, zoomAt, type View } from '../render2d/view.js';
	import type { AppState } from './app.svelte.js';

	let { app }: { app: AppState } = $props();

	let wrap: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let view = $state<View>(createView());
	let dpr = 1;
	let frame = 0;
	let pan: { x: number; y: number } | null = null;
	let dragging: { edit: GroundEdit; from: number; u: number; side: SlopeHandle['side'] } | null =
		null;
	let editing = $state<{
		target: GroundTarget;
		z: number;
		x: number;
		y: number;
		value: string;
	} | null>(null);
	let grab = $state<SlopeHandle | null>(null);
	let ghost = $state<{ u: number; z: number } | null>(null);
	let hot = $state<EntityId | null>(null);
	let onLine = $state(false);

	const FACINGS: Facing[] = ['s', 'e', 'n', 'w'];

	function draw(): void {
		const ctx = canvas?.getContext('2d', { alpha: false });
		if (!ctx) return;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = PLAN.paper;
		ctx.fillRect(0, 0, view.w, view.h);
		paintElevation(ctx, app.doc, app.field, app.facing, view, {
			years: app.years,
			month: app.month,
			grab,
			ghost,
			hot
		});
		ctx.restore();
	}

	function schedule(): void {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			draw();
		});
	}

	function fit(): void {
		if (view.w <= 1) return;
		view = fitTo(view, elevationBounds(app.doc, app.field, app.facing), 48);
	}

	onMount(() => {
		const ro = new ResizeObserver(() => {
			const r = wrap.getBoundingClientRect();
			dpr = window.devicePixelRatio || 1;
			canvas.width = Math.max(1, Math.round(r.width * dpr));
			canvas.height = Math.max(1, Math.round(r.height * dpr));
			canvas.style.width = `${r.width}px`;
			canvas.style.height = `${r.height}px`;
			view = { ...view, w: r.width, h: r.height };
			fit();
			schedule();
		});
		ro.observe(wrap);
		return () => {
			ro.disconnect();
			if (frame) cancelAnimationFrame(frame);
		};
	});

	// A different side is a different drawing, so it gets framed afresh. Untracked, because
	// framing writes the view this effect would otherwise depend on, which loops.
	$effect(() => {
		void app.facing;
		untrack(() => {
			fit();
			schedule();
		});
	});

	$effect(() => {
		void app.rev;
		void app.years;
		void view;
		void grab;
		void ghost;
		void hot;
		schedule();
	});

	/** Put whatever the edit needs into the document, as its own undo step. */
	function start(target: GroundTarget): GroundEdit {
		const edit = groundEdit(app.doc, app.field, app.facing, target);
		if (edit.create.length > 0) {
			app.history.run(new AddEntities(edit.create, 'Marknivå'));
		}
		return edit;
	}

	/** Both halves of a move in one step: the ground, and any house a tilt carries with it. */
	function moved(move: GroundMove): Entity[] {
		const out: Entity[] = [];
		for (const { id, z } of move.spots) {
			const e = findEntity(app.doc, id);
			if (e && e.k === 'spot') out.push({ ...e, z });
		}
		for (const { id, floor } of move.floors) {
			const e = findEntity(app.doc, id);
			if (e && e.k === 'wall' && (e.floor ?? 0) !== floor) out.push({ ...e, floor });
		}
		return out;
	}

	function move(edit: GroundEdit, dz: number, coalesce: boolean, label: string): void {
		const next = moved(edit.apply(dz));
		if (next.length === 0) return;
		const run = () => app.history.run(new ReplaceEntities(next, label));
		if (coalesce) app.history.coalesced(run);
		else run();
	}

	function pointerDown(e: PointerEvent): void {
		const r = canvas.getBoundingClientRect();
		const aim = aimAt(app.doc, app.field, app.facing, view, e.clientX - r.left, e.clientY - r.top);
		canvas.setPointerCapture(e.pointerId);
		if (!aim) {
			pan = { x: e.clientX, y: e.clientY };
			return;
		}
		dragging = { edit: start(aim.target), from: e.clientY, u: aim.u, side: aim.side };
		grab = { side: aim.side, u: aim.u, z: aim.z, at: { x: 0, y: 0 }, spot: null };
		ghost = null;
	}

	function pointerMove(e: PointerEvent): void {
		const r = canvas.getBoundingClientRect();
		if (dragging) {
			const dz = (dragging.from - e.clientY) / view.scale;
			if (Math.abs(dz) > 0.004) {
				move(dragging.edit, dz, true, dragging.side === 'along' ? 'Marknivå' : 'Luta tomten');
			}
			const now = handleAt(app.doc, app.field, app.facing, dragging.u, dragging.side);
			grab = now;
			return;
		}
		if (pan) {
			view = panBy(view, { x: e.clientX - pan.x, y: e.clientY - pan.y });
			pan = { x: e.clientX, y: e.clientY };
			return;
		}
		const aim = aimAt(app.doc, app.field, app.facing, view, e.clientX - r.left, e.clientY - r.top);
		onLine = aim !== null;
		hot = aim?.vertex ?? null;
		// Only the bare line offers a new vertex; over one that exists you would be moving it.
		ghost =
			aim && aim.side === 'along' && !aim.vertex
				? ghostAt(app.doc, app.field, app.facing, aim.u)
				: null;
	}

	function pointerUp(e: PointerEvent): void {
		const r = canvas.getBoundingClientRect();
		if (dragging) {
			const moved = Math.abs(dragging.from - e.clientY) > 3;
			if (!moved) {
				const p = toScreen(view, { x: dragging.u, y: dragging.edit.startZ });
				editing = {
					target:
						dragging.side === 'along'
							? { kind: 'point', u: dragging.u }
							: { kind: 'tilt', side: dragging.side === 'right' ? 'right' : 'left' },
					z: dragging.edit.startZ,
					x: Math.min(Math.max(8, p.x - 46), r.width - 104),
					y: Math.max(8, p.y - 34),
					value: dragging.edit.startZ.toFixed(2).replace('.', ',')
				};
			}
			dragging = null;
		}
		pan = null;
		grab = null;
		canvas.releasePointerCapture?.(e.pointerId);
	}

	function commitEditing(): void {
		const state = editing;
		editing = null;
		if (!state) return;
		const z = Number(state.value.replace(',', '.').trim());
		if (!Number.isFinite(z) || Math.abs(z - state.z) < 1e-9) return;
		const edit = groundEdit(app.doc, app.field, app.facing, state.target);
		const label = state.target.kind === 'tilt' ? 'Luta tomten' : 'Marknivå';
		const created = edit.create;
		const next = edit.apply(z - state.z);
		app.history.transact(label, () => {
			if (created.length > 0) app.history.run(new AddEntities(created, label));
			const next2 = moved(next);
			if (next2.length > 0) app.history.run(new ReplaceEntities(next2, label));
		});
	}

	function wheel(e: WheelEvent): void {
		e.preventDefault();
		const r = canvas.getBoundingClientRect();
		view = zoomAt(view, { x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY / 400));
	}
</script>

<div class="relative h-full w-full overflow-hidden" bind:this={wrap}>
	<canvas
		bind:this={canvas}
		class="block h-full w-full touch-none"
		style:cursor={onLine ? 'ns-resize' : 'grab'}
		aria-label="Fasadvy"
		onpointerdown={pointerDown}
		onpointermove={pointerMove}
		onpointerup={pointerUp}
		onpointercancel={pointerUp}
		onpointerleave={() => {
			ghost = null;
			hot = null;
			onLine = false;
		}}
		onwheel={wheel}
	></canvas>

	{#if editing}
		<input
			class="num absolute w-24 rounded border border-seed bg-paper px-1.5 py-0.5 text-right text-[12px] text-ink"
			style:left="{editing.x}px"
			style:top="{editing.y}px"
			value={editing.value}
			{@attach (el) => el.focus()}
			oninput={(e) => editing && (editing.value = e.currentTarget.value)}
			onkeydown={(e) => {
				if (e.key === 'Enter') commitEditing();
				if (e.key === 'Escape') editing = null;
			}}
			onblur={commitEditing}
		/>
	{/if}

	<div class="absolute top-2 left-2 flex gap-1 rounded-md bg-bark/90 p-1 text-[12px]">
		{#each FACINGS as f (f)}
			<button
				type="button"
				class="rounded px-2 py-1"
				class:bg-seed={app.facing === f}
				class:text-ink={app.facing === f}
				class:text-sage={app.facing !== f}
				aria-pressed={app.facing === f}
				onclick={() => (app.facing = f)}
			>
				{FACING_SV[f]}
			</button>
		{/each}
		<button
			type="button"
			class="rounded px-2 py-1 text-sage hover:text-chalk"
			onclick={() => {
				fit();
				schedule();
			}}
		>
			Anpassa
		</button>
	</div>

	<p class="absolute right-2 bottom-2 text-[11px] text-sage">
		Dra i ändarna för att luta hela tomten. Klicka på marklinjen för att sätta en punkt där, och dra
		den upp eller ner för att ändra marken just där.
	</p>
</div>
