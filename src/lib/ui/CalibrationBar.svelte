<script lang="ts">
	import type { PlanController } from './plan.svelte.js';

	let { plan }: { plan: PlanController } = $props();

	let input = $state<HTMLInputElement | null>(null);
	const ready = $derived(plan.draft?.t === 'calib' && plan.draft.b !== null);

	$effect(() => {
		if (ready) input?.focus();
	});
</script>

{#if plan.calibrating}
	<div
		class="absolute top-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-line bg-bark/95 px-3 py-2 shadow-[var(--lift-pop)] backdrop-blur"
	>
		{#if !ready}
			<span class="text-[12px] text-chalk"> Klicka i båda ändarna av något du vet längden på </span>
		{:else}
			<label class="flex items-center gap-2 text-[12px] text-sage">
				Verklig längd
				<input
					bind:this={input}
					class="num w-24 text-right"
					inputmode="decimal"
					value={plan.calibLength}
					oninput={(e) => (plan.calibLength = e.currentTarget.value)}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							plan.applyCalibration();
						}
					}}
				/>
				<span class="num">m</span>
			</label>
			<button
				type="button"
				class="rounded-md bg-seed px-3 py-1 text-[12px] font-medium text-ink transition-[filter] hover:brightness-110"
				onclick={() => plan.applyCalibration()}
			>
				Sätt skala
			</button>
		{/if}
		<button
			type="button"
			class="rounded-md px-2.5 py-1 text-[12px] text-sage transition-colors hover:bg-raised hover:text-chalk"
			onclick={() => plan.cancelCalibration()}
		>
			Avbryt
		</button>
	</div>
{/if}
