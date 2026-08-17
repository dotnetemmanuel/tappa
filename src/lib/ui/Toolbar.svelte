<script lang="ts">
	import { TOOLS, type AppState, type ToolId } from './app.svelte.js';

	let { app }: { app: AppState } = $props();

	const ICONS: Record<ToolId, string> = {
		select: 'M4 2 L14 10 L9 11 L11.5 15.5 L9.5 16.5 L7 12 L4 15 Z',
		pan: 'M9 2 v7 M6 4 v6 M12 4 v6 M4 8 v3 a5 5 0 0 0 10 0 V6',
		plot: 'M2 3 h14 v12 H2 Z',
		rect: 'M3 5 h12 v8 H3 Z',
		polygon: 'M9 2 L16 7 L13 15 H5 L2 7 Z',
		freehand: 'M2 12 c3 -6 5 4 8 -2 s4 -6 6 -2',
		path: 'M3 15 c0 -6 4 -6 6 -8 s2 -4 6 -4',
		fence: 'M2 6 h14 M2 11 h14 M5 3 v12 M9 3 v12 M13 3 v12',
		wall: 'M2 6 h14 v6 H2 Z M6 6 v6 M11 6 v6',
		plant: 'M9 16 v-6 M9 10 a4 4 0 1 1 0.1 0 M9 10 c-3 -1 -4 -3 -4 -5',
		prop: 'M3 8 h12 v6 H3 Z M4 8 V6 h10 v2 M5 14 v2 M13 14 v2',
		image: 'M2 4 h14 v10 H2 Z M2 11 l4 -4 3 3 3 -3 4 4',
		dim: 'M2 4 v10 M16 4 v10 M2 9 h14 M4 7 L2 9 L4 11 M14 7 L16 9 L14 11',
		spot: 'M2 12 c4 -3 8 -1 14 -5 M2 15.5 c4 -3 8 -1 14 -5 M5 3 L9 7 M9 3 L5 7',
		text: 'M3 4 h12 M9 4 v11 M6 15 h6'
	};
</script>

<nav class="flex flex-col gap-1 border-r border-line bg-bark p-1.5" aria-label="Verktyg">
	{#each TOOLS as t (t.id)}
		<button
			type="button"
			class="group relative flex h-9 w-9 items-center justify-center rounded-md transition-colors"
			class:bg-seed={app.tool === t.id}
			class:text-ink={app.tool === t.id}
			class:text-sage={app.tool !== t.id}
			class:hover:bg-line={app.tool !== t.id}
			class:hover:text-chalk={app.tool !== t.id}
			aria-pressed={app.tool === t.id}
			title="{t.sv}  ({t.key.toUpperCase()})"
			onclick={() => app.setTool(t.id)}
		>
			<svg viewBox="0 0 18 18" class="h-[18px] w-[18px]" aria-hidden="true">
				<path
					d={ICONS[t.id]}
					fill={t.id === 'select' ? 'currentColor' : 'none'}
					stroke="currentColor"
					stroke-width="1.4"
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
			</svg>
			<span class="sr-only">{t.sv}</span>
		</button>
	{/each}
</nav>

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
