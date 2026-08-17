<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { paintElevation, elevationBounds, FACING_SV, type Facing } from '../render2d/elevation.js';
	import { PLAN } from '../render2d/theme.js';
	import { createView, fitTo, panBy, zoomAt, type View } from '../render2d/view.js';
	import type { AppState } from './app.svelte.js';

	let { app }: { app: AppState } = $props();

	let wrap: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let view = $state<View>(createView());
	let dpr = 1;
	let frame = 0;
	let dragFrom: { x: number; y: number } | null = null;

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
		const b = elevationBounds(app.doc, app.field, app.facing);
		view = fitTo(view, b, 48);
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

	function pointerDown(e: PointerEvent): void {
		canvas.setPointerCapture(e.pointerId);
		dragFrom = { x: e.clientX, y: e.clientY };
	}

	function pointerMove(e: PointerEvent): void {
		if (!dragFrom) return;
		view = panBy(view, { x: e.clientX - dragFrom.x, y: e.clientY - dragFrom.y });
		dragFrom = { x: e.clientX, y: e.clientY };
	}

	function pointerUp(e: PointerEvent): void {
		dragFrom = null;
		canvas.releasePointerCapture?.(e.pointerId);
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
</div>
