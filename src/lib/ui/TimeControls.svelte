<script lang="ts">
	import { shadowStudy } from '../core/sun/shadow.js';
	import { sunAt, sunTimes } from '../core/sun/position.js';
	import { formatAngle } from '../core/doc/dimension.js';
	import type { AppState } from './app.svelte.js';

	let { app }: { app: AppState } = $props();

	const MONTHS = [
		'januari',
		'februari',
		'mars',
		'april',
		'maj',
		'juni',
		'juli',
		'augusti',
		'september',
		'oktober',
		'november',
		'december'
	];

	const dayOfYear = $derived.by(() => {
		const start = new Date(app.when.getFullYear(), 0, 1);
		return Math.round((app.when.getTime() - start.getTime()) / 86400000);
	});

	const minutes = $derived(app.when.getHours() * 60 + app.when.getMinutes());

	const sun = $derived.by(() => {
		void app.rev;
		return sunAt(app.doc, app.when);
	});

	const times = $derived.by(() => {
		void app.rev;
		return sunTimes(app.doc, app.when);
	});

	const clock = (d: Date): string =>
		`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

	function setDay(n: number): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local value handed to setWhen
		const d = new Date(app.when.getFullYear(), 0, 1);
		d.setDate(d.getDate() + n);
		d.setHours(app.when.getHours(), app.when.getMinutes(), 0, 0);
		app.setWhen(d);
	}

	function setMinutes(m: number): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local value handed to setWhen
		const d = new Date(app.when);
		d.setHours(Math.floor(m / 60), m % 60, 0, 0);
		app.setWhen(d);
	}

	async function runStudy(): Promise<void> {
		app.shadowBusy = true;
		app.status = 'Räknar soltimmar';
		// Let the button repaint before a study that blocks for a second or two.
		await new Promise((r) => setTimeout(r, 30));
		try {
			app.shadow = shadowStudy(app.doc, {
				day: app.when,
				stepMinutes: 15,
				cell: 0.5,
				years: app.years
			});
			app.showShadow = true;
			app.status = `Soltimmar den ${app.when.getDate()} ${MONTHS[app.when.getMonth()]}`;
		} catch (err) {
			app.status = err instanceof Error ? err.message : 'Solstudien misslyckades';
		} finally {
			app.shadowBusy = false;
		}
	}
</script>

<section class="border-b border-line p-3">
	<h2 class="heading mb-2 text-[13px] tracking-wide text-chalk">Tid och sol</h2>

	<label class="mb-2 block">
		<span class="mb-1 flex items-baseline justify-between text-[12px] text-sage">
			Datum
			<span class="num text-chalk">{app.when.getDate()} {MONTHS[app.when.getMonth()]}</span>
		</span>
		<input
			class="w-full accent-[var(--color-seed)]"
			type="range"
			min="0"
			max="364"
			value={dayOfYear}
			oninput={(e) => setDay(Number(e.currentTarget.value))}
		/>
	</label>

	<label class="mb-2 block">
		<span class="mb-1 flex items-baseline justify-between text-[12px] text-sage">
			Tid
			<span class="num text-chalk">{clock(app.when)}</span>
		</span>
		<input
			class="w-full accent-[var(--color-seed)]"
			type="range"
			min="0"
			max="1439"
			step="15"
			value={minutes}
			oninput={(e) => setMinutes(Number(e.currentTarget.value))}
		/>
	</label>

	<p class="num mb-3 text-[11px] text-sage">
		{#if times.up}
			Upp {clock(times.sunrise)} · ner {clock(times.sunset)} · höjd {formatAngle(sun.altitude)}
		{:else}
			Solen är nere hela dagen
		{/if}
	</p>

	<label class="mb-2 block">
		<span class="mb-1 flex items-baseline justify-between text-[12px] text-sage">
			År sedan plantering
			<span class="num text-chalk">{app.years}</span>
		</span>
		<input
			class="w-full accent-[var(--color-seed)]"
			type="range"
			min="0"
			max="30"
			step="1"
			bind:value={app.years}
		/>
	</label>

	<div class="flex items-center gap-2">
		<button
			type="button"
			class="flex-1 rounded border border-line px-2 py-1 text-[12px] text-sage hover:bg-line hover:text-chalk disabled:opacity-50"
			disabled={app.shadowBusy}
			onclick={runStudy}
		>
			{app.shadowBusy ? 'Räknar…' : 'Solstudie'}
		</button>
		{#if app.shadow}
			<label class="flex items-center gap-1.5 text-[12px] text-sage">
				<input type="checkbox" class="accent-[var(--color-seed)]" bind:checked={app.showShadow} />
				Visa
			</label>
		{/if}
	</div>
	{#if app.shadow}
		<p class="num mt-1.5 text-[11px] text-sage">
			Mest sol {app.shadow.maxHours.toFixed(1).replace('.', ',')} h av
			{app.shadow.dayLength.toFixed(1).replace('.', ',')} h
		</p>
	{/if}
</section>
