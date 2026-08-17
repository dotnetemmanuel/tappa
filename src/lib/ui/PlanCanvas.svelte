<script lang="ts">
	import { onMount } from 'svelte';
	import { createPainter, type Painter } from '../render2d/painter.js';
	import { getImageSync, onImageLoaded } from '../io/imagecache.js';
	import { runChecks, type Check } from '../core/analysis/checks.js';
	import type { AppState } from './app.svelte.js';
	import type { PlanController } from './plan.svelte.js';
	import Hud from './Hud.svelte';

	let { app, plan }: { app: AppState; plan: PlanController } = $props();

	let canvas: HTMLCanvasElement;
	let wrap: HTMLDivElement;
	let painter: Painter | null = null;
	let frame = 0;

	const checks = $derived.by((): Check[] => {
		void app.rev;
		if (!app.showChecks) return [];
		return runChecks(app.doc, { years: app.years, month: app.month, shadow: app.shadow, field: app.field });
	});

	function schedule(): void {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			painter?.draw(app.doc, app.view, {
				selection: app.selectionSet,
				draft: plan.draftShape,
				snap: plan.snapResult,
				hover: plan.hover,
				marquee: plan.marquee,
				showGrid: app.showGrid,
				showVertices: app.showVertices,
				years: app.years,
				month: app.month,
				shadow: app.showShadow ? app.shadow : null,
				checks,
				field: app.field,
				image: getImageSync
			});
		});
	}

	onMount(() => {
		painter = createPainter(canvas);
		const ro = new ResizeObserver(() => {
			const r = wrap.getBoundingClientRect();
			app.view = { ...app.view, w: r.width, h: r.height };
			painter?.resize(r.width, r.height, window.devicePixelRatio || 1);
			if (app.pendingFit) app.zoomToFit();
			schedule();
		});
		ro.observe(wrap);
		const stopImages = onImageLoaded(schedule);
		return () => {
			ro.disconnect();
			stopImages();
			if (frame) cancelAnimationFrame(frame);
		};
	});

	// Any change to the document, camera or in-flight draw repaints the surface.
	$effect(() => {
		void app.rev;
		void app.view;
		void app.selection;
		void app.showGrid;
		void plan.draft;
		void plan.snapResult;
		void plan.hover;
		void plan.marquee;
		void plan.cursor;
		void app.years;
		void app.showShadow;
		void app.shadow;
		void checks;
		schedule();
	});

	const cursorFor = (tool: string): string =>
		tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
</script>

<div class="relative h-full w-full overflow-hidden" bind:this={wrap}>
	<canvas
		bind:this={canvas}
		class="block h-full w-full touch-none"
		style:cursor={cursorFor(app.tool)}
		tabindex="0"
		aria-label="Planritning"
		onpointerdown={(e) => plan.pointerDown(e, canvas)}
		onpointermove={(e) => plan.pointerMove(e, canvas)}
		onpointerup={(e) => plan.pointerUp(e, canvas)}
		onpointercancel={(e) => plan.pointerUp(e, canvas)}
		onwheel={(e) => plan.wheel(e, canvas)}
		oncontextmenu={(e) => e.preventDefault()}
	></canvas>

	<Hud {plan} />
</div>
