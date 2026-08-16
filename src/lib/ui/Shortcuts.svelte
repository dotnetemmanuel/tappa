<script lang="ts">
	import { TOOLS } from './app.svelte.js';

	let { open = $bindable(false) }: { open: boolean } = $props();

	const GENERAL: [string, string][] = [
		['Ctrl+Z', 'Ångra'],
		['Ctrl+Skift+Z', 'Gör om'],
		['Ctrl+A', 'Markera allt'],
		['Delete', 'Ta bort det som är valt'],
		['Escape', 'Avbryt det du ritar'],
		['Enter', 'Avsluta linjen eller ytan'],
		['Backsteg', 'Ta bort senaste punkten'],
		['0', 'Anpassa vyn till ritningen'],
		['Piltangenter', 'Flytta 10 cm, med Skift 1 m'],
		['?', 'Den här listan']
	];

	const DRAWING: [string, string][] = [
		['Siffror', 'Skriv exakt längd, Enter låser sträckan'],
		['Tabb', 'Växla mellan längd och vinkel'],
		['Skift', 'Lås rätvinkligt medan du ritar'],
		['Alt + dra', 'Panorera oavsett verktyg'],
		['Rulle', 'Zooma mot pekaren'],
		['Skift + klick', 'Lägg till eller ta bort ur markeringen']
	];
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6"
		role="dialog"
		aria-modal="true"
		aria-label="Kortkommandon"
	>
		<button
			type="button"
			class="absolute inset-0 cursor-default"
			aria-label="Stäng kortkommandon"
			onclick={() => (open = false)}
		></button>
		<div
			class="relative max-h-full w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-bark p-5 shadow-2xl shadow-black/50"
		>
			<div class="mb-4 flex items-baseline justify-between">
				<h2 class="heading text-[16px] text-chalk">Kortkommandon</h2>
				<button
					type="button"
					class="rounded px-2 py-1 text-[12px] text-sage hover:bg-line hover:text-chalk"
					onclick={() => (open = false)}
				>
					Stäng
				</button>
			</div>

			<div class="grid gap-6 sm:grid-cols-3">
				<section>
					<h3 class="mb-2 text-[11px] uppercase tracking-wide text-sage/70">Verktyg</h3>
					<dl class="space-y-1">
						{#each TOOLS as t (t.id)}
							<div class="flex items-baseline justify-between gap-2 text-[12px]">
								<dt class="num text-seed">{t.key.toUpperCase()}</dt>
								<dd class="flex-1 text-right text-sage">{t.sv}</dd>
							</div>
						{/each}
					</dl>
				</section>

				<section>
					<h3 class="mb-2 text-[11px] uppercase tracking-wide text-sage/70">Ritande</h3>
					<dl class="space-y-1">
						{#each DRAWING as [key, what] (key)}
							<div class="flex items-baseline justify-between gap-2 text-[12px]">
								<dt class="num shrink-0 text-seed">{key}</dt>
								<dd class="text-right text-sage">{what}</dd>
							</div>
						{/each}
					</dl>
				</section>

				<section>
					<h3 class="mb-2 text-[11px] uppercase tracking-wide text-sage/70">Allmänt</h3>
					<dl class="space-y-1">
						{#each GENERAL as [key, what] (key)}
							<div class="flex items-baseline justify-between gap-2 text-[12px]">
								<dt class="num shrink-0 text-seed">{key}</dt>
								<dd class="text-right text-sage">{what}</dd>
							</div>
						{/each}
					</dl>
				</section>
			</div>
		</div>
	</div>
{/if}
