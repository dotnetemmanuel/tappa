<script lang="ts">
	import { onMount } from 'svelte';
	import { PlanScene, type CameraMode } from '../render3d/scene.js';
	import { drawCompass } from '../render2d/compass.js';
	import type { AppState } from './app.svelte.js';

	let { app }: { app: AppState } = $props();

	let canvas: HTMLCanvasElement;
	let wrap: HTMLDivElement;
	let scene = $state<PlanScene | null>(null);
	let rose = $state<HTMLCanvasElement | null>(null);
	let mode = $state<CameraMode>('orbit');
	let failed = $state('');

	onMount(() => {
		let s: PlanScene;
		try {
			s = new PlanScene(canvas, app.doc, {
				years: app.years,
				month: app.month,
				when: app.when,
				field: app.field
			});
		} catch (err) {
			failed = err instanceof Error ? err.message : 'Kunde inte starta 3D-vyn';
			return;
		}
		s.onPick = (id, additive) => {
			if (!id) app.clearSelection();
			else if (additive) app.toggleSelect(id);
			else app.select([id]);
		};
		scene = s;
		app.sceneCanvas = canvas;
		app.sceneCapture = (scale: number) => s.capture(scale);

		const ro = new ResizeObserver(() => {
			const r = wrap.getBoundingClientRect();
			s.resize(r.width, r.height);
		});
		ro.observe(wrap);

		// The rose follows the camera, so it redraws on its own rather than on a document change.
		let raf = 0;
		let drawnAt = Number.NaN;
		const tick = (): void => {
			raf = requestAnimationFrame(tick);
			const up = s.northOnScreen;
			if (Math.abs(up - drawnAt) < 0.004) return;
			drawnAt = up;
			drawRose(up);
		};
		tick();

		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			s.dispose();
			scene = null;
			app.sceneCanvas = null;
			app.sceneCapture = null;
		};
	});

	// The document is the single source of truth, so any edit rebuilds the scene.
	$effect(() => {
		void app.rev;
		// The field has to land before the rebuild, or the scene builds the new document on old ground.
		scene?.setOptions({ field: app.field });
		scene?.setDoc(app.doc);
	});

	$effect(() => {
		scene?.setOptions({ years: app.years, month: app.month, when: app.when });
	});

	const ROSE_PX = 116;

	function drawRose(up: number): void {
		const ctx = rose?.getContext('2d');
		if (!ctx || !rose) return;
		const dpr = window.devicePixelRatio || 1;
		if (rose.width !== ROSE_PX * dpr) {
			rose.width = ROSE_PX * dpr;
			rose.height = ROSE_PX * dpr;
		}
		const style = getComputedStyle(document.documentElement);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, ROSE_PX, ROSE_PX);
		drawCompass(ctx, { x: ROSE_PX / 2, y: ROSE_PX / 2 }, 32, up, {
			ink: style.getPropertyValue('--color-chalk').trim() || '#e9efe6',
			faint: style.getPropertyValue('--color-sage').trim() || '#93a89b'
		});
	}

	function setMode(next: CameraMode): void {
		mode = next;
		scene?.setMode(next);
	}
</script>

<div class="relative h-full w-full overflow-hidden bg-ink" bind:this={wrap}>
	<canvas bind:this={canvas} class="block h-full w-full touch-none" aria-label="Trädgården i 3D"
	></canvas>

	{#if failed}
		<div class="absolute inset-0 flex items-center justify-center p-6">
			<p class="max-w-xs text-center text-[13px] leading-relaxed text-sage">
				{failed}. Kortet klarar troligen inte WebGL. Planritningen fungerar ändå.
			</p>
		</div>
	{:else}
		<div
			class="absolute top-4 left-4 flex gap-0.5 rounded-lg border border-line bg-bark/95 p-1 shadow-[var(--lift-pop)] backdrop-blur"
		>
			<button
				type="button"
				class="rounded px-2.5 py-1 text-[12px] font-medium transition-colors"
				class:bg-seed={mode === 'orbit'}
				class:text-ink={mode === 'orbit'}
				class:text-sage={mode !== 'orbit'}
				aria-pressed={mode === 'orbit'}
				onclick={() => setMode('orbit')}
			>
				Överblick
			</button>
			<button
				type="button"
				class="rounded px-2.5 py-1 text-[12px] font-medium transition-colors"
				class:bg-seed={mode === 'walk'}
				class:text-ink={mode === 'walk'}
				class:text-sage={mode !== 'walk'}
				aria-pressed={mode === 'walk'}
				onclick={() => setMode('walk')}
			>
				Gå omkring
			</button>
			<button
				type="button"
				class="rounded px-2.5 py-1 text-[12px] text-sage transition-colors hover:bg-raised hover:text-chalk"
				onclick={() => scene?.frameAll()}
			>
				Anpassa
			</button>
		</div>

		<canvas
			bind:this={rose}
			class="pointer-events-none absolute right-4 bottom-4 h-[116px] w-[116px] rounded-full border border-line bg-bark/85 backdrop-blur"
			aria-hidden="true"
		></canvas>

		{#if mode === 'walk'}
			<p
				class="num absolute bottom-3 left-3 rounded-md border border-line bg-bark/95 px-2 py-1 text-[11px] text-sage"
			>
				WASD går · dra för att titta · Skift springer · ögonhöjd 1,7 m
			</p>
		{/if}
	{/if}
</div>
