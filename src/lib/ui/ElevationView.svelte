<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { AddEntities, ReplaceEntities } from '../core/cmd/edits.js';
	import { makeSpot } from '../core/doc/factory.js';
	import { findEntity } from '../core/doc/doc.js';
	import { handleHitBox, paintElevation } from '../render2d/elevation.js';
	import {
		elevationBounds,
		slopeHandles,
		FACING_SV,
		type Facing,
		type SlopeHandle
	} from '../core/terrain/section.js';
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
	let dragging: { handle: SlopeHandle; spot: string; from: number; startZ: number } | null = null;
	let editing = $state<{ handle: SlopeHandle; x: number; y: number; value: string } | null>(null);

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
			month: app.month
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
		schedule();
	});

	const handles = $derived.by((): SlopeHandle[] => {
		void app.rev;
		void app.facing;
		return slopeHandles(app.doc, app.field, app.facing);
	});

	function handleAt(x: number, y: number): SlopeHandle | null {
		for (const h of handles) {
			const box = handleHitBox(view, h);
			if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) return h;
		}
		return null;
	}

	/**
	 * The ground at one end is a height point there. If there is not one yet, the first drag
	 * or edit puts one in, so the number you grab is always something the document holds.
	 */
	function spotFor(h: SlopeHandle): string {
		if (h.spot && findEntity(app.doc, h.spot)) return h.spot;
		const spot = makeSpot(h.at, Math.round(h.z * 100) / 100);
		app.history.run(new AddEntities([spot], 'Marknivå'));
		return spot.id;
	}

	function setSpot(id: string, z: number, coalesce: boolean): void {
		const e = findEntity(app.doc, id);
		if (!e || e.k !== 'spot') return;
		const next = { ...e, z: Math.round(z * 100) / 100 };
		if (coalesce)
			app.history.coalesced(() => app.history.run(new ReplaceEntities([next], 'Marknivå')));
		else app.history.run(new ReplaceEntities([next], 'Marknivå'));
	}

	function pointerDown(e: PointerEvent): void {
		const r = canvas.getBoundingClientRect();
		const x = e.clientX - r.left;
		const y = e.clientY - r.top;
		const hit = handleAt(x, y);
		if (hit) {
			canvas.setPointerCapture(e.pointerId);
			const spot = spotFor(hit);
			const held = findEntity(app.doc, spot);
			dragging = {
				handle: hit,
				spot,
				from: e.clientY,
				startZ: held && held.k === 'spot' ? held.z : hit.z
			};
			return;
		}
		canvas.setPointerCapture(e.pointerId);
		pan = { x: e.clientX, y: e.clientY };
	}

	function pointerMove(e: PointerEvent): void {
		if (dragging) {
			const dz = (dragging.from - e.clientY) / view.scale;
			if (Math.abs(dz) > 0.005) {
				setSpot(dragging.spot, dragging.startZ + dz, true);
			}
			return;
		}
		if (!pan) return;
		view = panBy(view, { x: e.clientX - pan.x, y: e.clientY - pan.y });
		pan = { x: e.clientX, y: e.clientY };
	}

	function pointerUp(e: PointerEvent): void {
		const r = canvas.getBoundingClientRect();
		if (dragging) {
			const moved = Math.abs(dragging.from - e.clientY) > 3;
			if (!moved) startEditing(dragging.handle, r);
			dragging = null;
		}
		pan = null;
		canvas.releasePointerCapture?.(e.pointerId);
	}

	function startEditing(h: SlopeHandle, r: DOMRect): void {
		const p = toScreen(view, { x: h.u, y: h.z });
		editing = {
			handle: h,
			x: Math.min(Math.max(8, p.x - 40), r.width - 96),
			y: Math.max(8, p.y - 14),
			value: h.z.toFixed(2).replace('.', ',')
		};
	}

	function commitEditing(): void {
		const state = editing;
		editing = null;
		if (!state) return;
		const z = Number(state.value.replace(',', '.').trim());
		if (!Number.isFinite(z)) return;
		setSpot(spotFor(state.handle), z, false);
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
		aria-label="Fasadvy"
		onpointerdown={pointerDown}
		onpointermove={pointerMove}
		onpointerup={pointerUp}
		onpointercancel={pointerUp}
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
		Dra i en marknivå för att luta tomten, klicka på siffran för att skriva in den.
	</p>
</div>
