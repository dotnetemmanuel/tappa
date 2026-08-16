<script lang="ts">
	import { BY_CAT, searchSpecies, SPECIES } from '../core/plants/catalog.js';
	import { PROPS, PROPS_BY_CAT, searchProps } from '../core/props/catalog.js';
	import type { PlantCat } from '../core/plants/types.js';
	import type { PropCat } from '../core/props/types.js';
	import type { AppState } from './app.svelte.js';

	let { app }: { app: AppState } = $props();

	let query = $state('');

	const CAT_SV: Record<PlantCat, string> = {
		tree: 'Träd',
		shrub: 'Buskar',
		conifer: 'Barrväxter',
		hedge: 'Häckväxter',
		perennial: 'Perenner',
		grass: 'Gräs',
		fern: 'Ormbunkar',
		bulb: 'Lökar',
		climber: 'Klätterväxter',
		groundcover: 'Marktäckare',
		edible: 'Ätbart'
	};

	const PROP_CAT_SV: Record<PropCat, string> = {
		sitting: 'Sitta',
		growing: 'Odla',
		structure: 'Byggt',
		play: 'Leka',
		utility: 'Nytta',
		water: 'Vatten',
		nature: 'Natur'
	};

	const showProps = $derived(app.tool === 'prop');

	const plantResults = $derived(query.trim() ? searchSpecies(query) : null);
	const propResults = $derived(query.trim() ? searchProps(query) : null);
</script>

<section class="flex min-h-0 flex-1 flex-col border-b border-line">
	<div class="flex items-center gap-2 px-3 pb-2 pt-3">
		<h2 class="heading text-[13px] tracking-wide text-chalk">
			{showProps ? 'Föremål' : 'Växter'}
		</h2>
		<span class="num text-[11px] text-sage">
			{showProps ? PROPS.length : SPECIES.length}
		</span>
	</div>

	<div class="px-3 pb-2">
		<input
			class="w-full rounded bg-ink px-2 py-1 text-[12px] text-chalk placeholder:text-sage/70"
			placeholder={showProps ? 'Sök föremål' : 'Sök art, svenskt eller latin'}
			bind:value={query}
			aria-label="Sök"
		/>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
		{#if showProps}
			{#if propResults}
				<ul class="space-y-0.5">
					{#each propResults as p (p.id)}
						<li>
							<button
								type="button"
								class="w-full rounded px-1.5 py-1 text-left text-[12px] transition-colors"
								class:bg-line={app.activeProp === p.id}
								class:text-chalk={app.activeProp === p.id}
								class:text-sage={app.activeProp !== p.id}
								onclick={() => {
									app.activeProp = p.id;
									app.setTool('prop');
								}}
							>
								{p.sv}
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				{#each [...PROPS_BY_CAT] as [cat, items] (cat)}
					<h3 class="mb-1 mt-2 text-[11px] uppercase tracking-wide text-sage/70">
						{PROP_CAT_SV[cat]}
					</h3>
					<ul class="space-y-0.5">
						{#each items as p (p.id)}
							<li>
								<button
									type="button"
									class="w-full rounded px-1.5 py-1 text-left text-[12px] transition-colors"
									class:bg-line={app.activeProp === p.id}
									class:text-chalk={app.activeProp === p.id}
									class:text-sage={app.activeProp !== p.id}
									onclick={() => {
										app.activeProp = p.id;
										app.setTool('prop');
									}}
								>
									{p.sv}
								</button>
							</li>
						{/each}
					</ul>
				{/each}
			{/if}
		{:else if plantResults}
			<ul class="space-y-0.5">
				{#each plantResults as sp (sp.id)}
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors"
							class:bg-line={app.activeSpecies === sp.id}
							onclick={() => {
								app.activeSpecies = sp.id;
								app.setTool('plant');
							}}
						>
							<span
								class="h-3 w-3 shrink-0 rounded-full"
								style:background={sp.foliage.summer}
							></span>
							<span class="min-w-0 flex-1">
								<span
									class="block truncate text-[12px]"
									class:text-chalk={app.activeSpecies === sp.id}
									class:text-sage={app.activeSpecies !== sp.id}>{sp.sv}</span
								>
								<span class="block truncate text-[10px] italic text-sage/70">{sp.latin}</span>
							</span>
							<span class="num shrink-0 text-[10px] text-sage/70">{sp.mature.h} m</span>
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			{#each [...BY_CAT] as [cat, items] (cat)}
				<h3 class="mb-1 mt-2 text-[11px] uppercase tracking-wide text-sage/70">{CAT_SV[cat]}</h3>
				<ul class="space-y-0.5">
					{#each items as sp (sp.id)}
						<li>
							<button
								type="button"
								class="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors"
								class:bg-line={app.activeSpecies === sp.id}
								onclick={() => {
									app.activeSpecies = sp.id;
									app.setTool('plant');
								}}
							>
								<span
									class="h-3 w-3 shrink-0 rounded-full"
									style:background={sp.foliage.summer}
								></span>
								<span class="min-w-0 flex-1">
									<span
										class="block truncate text-[12px]"
										class:text-chalk={app.activeSpecies === sp.id}
										class:text-sage={app.activeSpecies !== sp.id}>{sp.sv}</span
									>
									<span class="block truncate text-[10px] italic text-sage/70">{sp.latin}</span>
								</span>
								<span class="num shrink-0 text-[10px] text-sage/70">{sp.mature.h} m</span>
							</button>
						</li>
					{/each}
				</ul>
			{/each}
		{/if}
	</div>
</section>
