<script lang="ts">
	import { formatBearing, formatLength } from '../core/doc/dimension.js';
	import { angle, sub } from '../core/geom/vec2.js';
	import type { SnapKind } from '../core/geom/snap.js';
	import type { AppState } from './app.svelte.js';
	import type { PlanController } from './plan.svelte.js';

	let { app, plan }: { app: AppState; plan: PlanController } = $props();

	const SNAP_LABELS: { k: SnapKind; sv: string }[] = [
		{ k: 'vertex', sv: 'Hörn' },
		{ k: 'midpoint', sv: 'Mitt' },
		{ k: 'perpendicular', sv: 'Vinkelrätt' },
		{ k: 'extension', sv: 'Förlängning' },
		{ k: 'angle', sv: 'Vinkellås' },
		{ k: 'grid', sv: 'Rutnät' }
	];

	const KIND_SV: Partial<Record<SnapKind, string>> = {
		vertex: 'hörn',
		endpoint: 'ändpunkt',
		midpoint: 'mittpunkt',
		centre: 'centrum',
		perpendicular: 'vinkelrätt',
		tangent: 'tangent',
		extension: 'förlängning',
		intersection: 'skärning',
		angle: 'vinkellås',
		grid: 'rutnät'
	};

	function toggleSnap(k: SnapKind): void {
		app.snapSettings = {
			...app.snapSettings,
			toggles: { ...app.snapSettings.toggles, [k]: !app.snapSettings.toggles[k] }
		};
	}

	const bearing = $derived(
		formatBearing(angle(sub(plan.cursor, { x: 0, y: 0 })), app.doc.meta.northOffset)
	);
</script>

<footer
	class="flex h-8 shrink-0 items-center gap-3 border-t border-line bg-bark px-3 text-[11px] text-sage"
>
	<span class="num tabular-nums">
		{plan.cursor.x.toFixed(2).replace('.', ',')}, {plan.cursor.y.toFixed(2).replace('.', ',')} m
	</span>
	<span class="hidden sm:inline">{bearing}</span>

	<span class="h-4 w-px bg-line"></span>

	<span class="num">1 m = {app.view.scale.toFixed(0)} px</span>
	<button
		type="button"
		class="rounded px-1.5 py-0.5 hover:bg-line hover:text-chalk"
		onclick={() => app.zoomToFit()}
	>
		Anpassa
	</button>

	<span class="h-4 w-px bg-line"></span>

	<div class="flex items-center gap-1" role="group" aria-label="Fästpunkter">
		{#each SNAP_LABELS as s (s.k)}
			<button
				type="button"
				class="rounded px-1.5 py-0.5 transition-colors"
				class:bg-line={app.snapSettings.toggles[s.k]}
				class:text-chalk={app.snapSettings.toggles[s.k]}
				class:hover:text-chalk={!app.snapSettings.toggles[s.k]}
				aria-pressed={app.snapSettings.toggles[s.k]}
				onclick={() => toggleSnap(s.k)}
			>
				{s.sv}
			</button>
		{/each}
	</div>

	<span class="ml-auto truncate">
		{#if plan.snapResult && plan.snapResult.kind !== 'free'}
			<span class="text-seed">{KIND_SV[plan.snapResult.kind] ?? plan.snapResult.kind}</span>
			{#if plan.hud.visible}
				<span class="num ml-2">{formatLength(Number(plan.hud.length.replace(',', '.')) || 0)}</span>
			{/if}
		{:else}
			{app.status}
		{/if}
	</span>
</footer>
