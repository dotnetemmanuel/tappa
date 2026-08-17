<script lang="ts">
	import { LINE_STYLES, MATERIALS } from '../core/doc/materials.js';
	import { swatchDataUrl } from '../render2d/patterns.js';
	import type { AppState } from './app.svelte.js';

	let { app }: { app: AppState } = $props();

	const showFences = $derived(app.tool === 'fence');
</script>

<section class="card p-3">
	<h2 class="card-title mb-2.5">{showFences ? 'Linjer' : 'Material'}</h2>

	{#if showFences}
		<div class="grid grid-cols-2 gap-1">
			{#each LINE_STYLES as s (s.id)}
				<button
					type="button"
					class="flex items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] transition-colors"
					class:bg-line={app.activeLineStyle === s.id}
					class:text-chalk={app.activeLineStyle === s.id}
					class:text-sage={app.activeLineStyle !== s.id}
					class:hover:bg-line={app.activeLineStyle !== s.id}
					aria-pressed={app.activeLineStyle === s.id}
					onclick={() => (app.activeLineStyle = s.id)}
				>
					<span class="h-3.5 w-3.5 shrink-0 rounded-sm" style:background={s.colour}></span>
					<span class="truncate">{s.sv}</span>
				</button>
			{/each}
		</div>
		<label class="mt-2 flex items-center justify-between gap-2 text-[12px] text-sage">
			Höjd
			<span class="flex items-center gap-1">
				<input
					class="num w-16 text-right"
					type="number"
					min="0.1"
					step="0.1"
					bind:value={app.fenceHeight}
				/>
				<span class="num">m</span>
			</span>
		</label>
	{:else}
		<div class="grid grid-cols-2 gap-1">
			{#each MATERIALS as m (m.id)}
				<button
					type="button"
					class="flex items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] transition-colors"
					class:bg-line={app.activeMat === m.id}
					class:text-chalk={app.activeMat === m.id}
					class:text-sage={app.activeMat !== m.id}
					class:hover:bg-line={app.activeMat !== m.id}
					aria-pressed={app.activeMat === m.id}
					onclick={() => (app.activeMat = m.id)}
				>
					<img
						class="h-3.5 w-3.5 shrink-0 rounded-sm"
						src={swatchDataUrl(m.pattern, m.fill, m.stroke, 14)}
						alt=""
					/>
					<span class="truncate">{m.sv}</span>
				</button>
			{/each}
		</div>
		{#if app.tool === 'path'}
			<label class="mt-2 flex items-center justify-between gap-2 text-[12px] text-sage">
				Bredd
				<span class="flex items-center gap-1">
					<input
						class="num w-16 text-right"
						type="number"
						min="0.2"
						step="0.1"
						bind:value={app.pathWidth}
					/>
					<span class="num">m</span>
				</span>
			</label>
		{/if}
	{/if}
</section>
