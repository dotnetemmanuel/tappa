<script lang="ts">
	import { onMount } from 'svelte';
	import { PlanScene, type CameraMode } from '../render3d/scene.js';
	import type { AppState } from './app.svelte.js';

	let { app }: { app: AppState } = $props();

	let canvas: HTMLCanvasElement;
	let wrap: HTMLDivElement;
	let scene = $state<PlanScene | null>(null);
	let mode = $state<CameraMode>('orbit');
	let failed = $state('');

	onMount(() => {
		let s: PlanScene;
		try {
			s = new PlanScene(canvas, app.doc, {
				years: app.years,
				month: app.month,
				when: app.when
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

		const ro = new ResizeObserver(() => {
			const r = wrap.getBoundingClientRect();
			s.resize(r.width, r.height);
		});
		ro.observe(wrap);

		return () => {
			ro.disconnect();
			s.dispose();
			scene = null;
			app.sceneCanvas = null;
		};
	});

	// The document is the single source of truth, so any edit rebuilds the scene.
	$effect(() => {
		void app.rev;
		scene?.setDoc(app.doc);
	});

	$effect(() => {
		scene?.setOptions({ years: app.years, month: app.month, when: app.when });
	});

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
		<div class="absolute left-2 top-2 flex gap-1 rounded-md border border-line bg-bark/90 p-0.5">
			<button
				type="button"
				class="rounded px-2 py-1 text-[12px]"
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
				class="rounded px-2 py-1 text-[12px]"
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
				class="rounded px-2 py-1 text-[12px] text-sage hover:text-chalk"
				onclick={() => scene?.frameAll()}
			>
				Anpassa
			</button>
		</div>

		{#if mode === 'walk'}
			<p
				class="num absolute bottom-2 left-2 rounded bg-bark/90 px-2 py-1 text-[11px] text-sage"
			>
				WASD går · dra för att titta · Skift springer · ögonhöjd 1,7 m
			</p>
		{/if}
	{/if}
</div>
