<script lang="ts">
	import type { PlanController } from './plan.svelte.js';

	let { plan }: { plan: PlanController } = $props();

	let lengthEl = $state<HTMLInputElement | null>(null);
	let angleEl = $state<HTMLInputElement | null>(null);

	function onKey(ev: KeyboardEvent, field: 'length' | 'angle'): void {
		if (ev.key === 'Enter') {
			ev.preventDefault();
			plan.commitHud();
			lengthEl?.blur();
			angleEl?.blur();
			return;
		}
		if (ev.key === 'Tab') {
			ev.preventDefault();
			(field === 'length' ? angleEl : lengthEl)?.focus();
			(field === 'length' ? angleEl : lengthEl)?.select();
			return;
		}
		if (ev.key === 'Escape') {
			ev.preventDefault();
			plan.cancel();
		}
	}
</script>

{#if plan.hud.visible}
	<div
		class="pointer-events-auto absolute z-20 flex items-center gap-1 rounded-md border border-line/80 bg-bark/95 px-1.5 py-1 shadow-lg shadow-black/40 backdrop-blur"
		style:left="{plan.hud.at.x}px"
		style:top="{plan.hud.at.y}px"
	>
		<label class="sr-only" for="hud-length">Längd i meter</label>
		<input
			id="hud-length"
			bind:this={lengthEl}
			class="num w-20 rounded bg-ink px-1.5 py-0.5 text-right text-[13px] text-chalk outline-none ring-1 ring-inset ring-transparent focus:ring-seed"
			class:ring-seed={plan.hud.lengthLocked}
			value={plan.hud.length}
			inputmode="decimal"
			autocomplete="off"
			spellcheck="false"
			oninput={(e) => plan.setHudLength(e.currentTarget.value)}
			onkeydown={(e) => onKey(e, 'length')}
		/>
		<span class="num text-[11px] text-sage">m</span>

		<span class="mx-0.5 h-4 w-px bg-line"></span>

		<label class="sr-only" for="hud-angle">Vinkel i grader</label>
		<input
			id="hud-angle"
			bind:this={angleEl}
			class="num w-16 rounded bg-ink px-1.5 py-0.5 text-right text-[13px] text-chalk outline-none ring-1 ring-inset ring-transparent focus:ring-seed"
			class:ring-seed={plan.hud.angleLocked}
			value={plan.hud.angle}
			inputmode="decimal"
			autocomplete="off"
			spellcheck="false"
			oninput={(e) => plan.setHudAngle(e.currentTarget.value)}
			onkeydown={(e) => onKey(e, 'angle')}
		/>
		<span class="num text-[11px] text-sage">°</span>
	</div>
{/if}

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
