<script lang="ts">
	import { SetLayers } from '../core/cmd/edits.js';
	import type { AppState } from './app.svelte.js';

	let { app }: { app: AppState } = $props();

	// The document sits outside the rune graph, so the list has to be read through
	// `rev` or the icons never redraw and the buttons look dead.
	const layers = $derived.by(() => {
		void app.rev;
		return app.doc.layers.map((l) => ({ ...l }));
	});

	const counts = $derived.by((): Record<string, number> => {
		void app.rev;
		const c: Record<string, number> = {};
		for (const e of app.doc.entities) c[e.layer] = (c[e.layer] ?? 0) + 1;
		return c;
	});

	let open = $state(true);

	function toggle(id: string, field: 'visible' | 'locked'): void {
		app.history.run(
			new SetLayers(app.doc.layers.map((l) => (l.id === id ? { ...l, [field]: !l[field] } : l)))
		);
	}
</script>

<section class="card p-3">
	<button
		type="button"
		class="mb-2 flex w-full items-center justify-between text-left"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="card-title">Lager</span>
		<svg viewBox="0 0 12 12" class="h-3 w-3 text-sage" aria-hidden="true">
			<path
				d={open ? 'M2 7.5 6 3.5 10 7.5' : 'M2 4.5 6 8.5 10 4.5'}
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</button>
	<ul class="space-y-0.5" class:hidden={!open}>
		{#each layers as l (l.id)}
			<li class="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-[12px] hover:bg-raised">
				<button
					type="button"
					class="rounded p-1 text-sage hover:text-chalk"
					aria-pressed={l.visible}
					title={l.visible ? 'Dölj lagret' : 'Visa lagret'}
					onclick={() => toggle(l.id, 'visible')}
				>
					<svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true">
						{#if l.visible}
							<path
								d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z"
								fill="none"
								stroke="currentColor"
								stroke-width="1.3"
							/>
							<circle cx="8" cy="8" r="1.8" fill="currentColor" />
						{:else}
							<path
								d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8Z M2 2 l12 12"
								fill="none"
								stroke="currentColor"
								stroke-width="1.3"
							/>
						{/if}
					</svg>
					<span class="sr-only">{l.visible ? 'Dölj' : 'Visa'} {l.name}</span>
				</button>
				<button
					type="button"
					class="rounded p-1 hover:text-chalk"
					class:text-seed={l.locked}
					class:text-sage={!l.locked}
					aria-pressed={l.locked}
					title={l.locked ? 'Lås upp lagret' : 'Lås lagret'}
					onclick={() => toggle(l.id, 'locked')}
				>
					<svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true">
						<rect
							x="3.5"
							y="7"
							width="9"
							height="6.5"
							rx="1"
							fill="none"
							stroke="currentColor"
							stroke-width="1.3"
						/>
						<path
							d={l.locked ? 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0'}
							fill="none"
							stroke="currentColor"
							stroke-width="1.3"
						/>
					</svg>
					<span class="sr-only">{l.locked ? 'Lås upp' : 'Lås'} {l.name}</span>
				</button>
				<span class="flex-1 truncate" class:text-sage={!l.visible} class:text-chalk={l.visible}>
					{l.name}
				</span>
				<span class="num text-[11px] text-sage">{counts[l.id] ?? 0}</span>
			</li>
		{/each}
	</ul>
</section>

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
