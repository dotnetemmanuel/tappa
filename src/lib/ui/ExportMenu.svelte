<script lang="ts">
	import {
		downloadBlob,
		exportElevationPng,
		exportPlanPng,
		exportViewPng
	} from '../io/export-image.js';
	import { exportPdf } from '../io/export-pdf.js';
	import { plantingListCsv, takeoffCsv } from '../io/takeoff.js';
	import { suggestFilename } from '../io/tappa.js';
	import type { AppState } from './app.svelte.js';

	let { app, sceneCanvas }: { app: AppState; sceneCanvas: HTMLCanvasElement | null } = $props();

	let open = $state(false);
	let busy = $state('');

	const stem = $derived(suggestFilename(app.doc).replace(/\.tappa$/, ''));

	function text(name: string, body: string): void {
		downloadBlob(new Blob([body], { type: 'text/csv;charset=utf-8' }), name);
	}

	async function run(label: string, fn: () => Promise<void>): Promise<void> {
		busy = label;
		try {
			await fn();
			app.status = `${label} klar`;
		} catch (err) {
			app.status = err instanceof Error ? err.message : `${label} misslyckades`;
		} finally {
			busy = '';
			open = false;
		}
	}
</script>

<div class="relative">
	<button
		type="button"
		class="rounded px-2 py-1 text-[12px] text-sage hover:bg-line hover:text-chalk"
		aria-expanded={open}
		aria-haspopup="menu"
		onclick={() => (open = !open)}
	>
		{busy || 'Exportera'}
	</button>

	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="fixed inset-0 z-40"
			onclick={() => (open = false)}
			onkeydown={(e) => e.key === 'Escape' && (open = false)}
		></div>
		<div
			class="absolute right-0 z-50 mt-1 w-56 rounded-md border border-line bg-bark p-1 shadow-xl shadow-black/40"
			role="menu"
		>
			<button
				type="button"
				role="menuitem"
				class="block w-full rounded px-2 py-1.5 text-left text-[12px] text-sage hover:bg-line hover:text-chalk"
				onclick={() =>
					run('Planritning', async () =>
						downloadBlob(
							await exportPlanPng(app.doc, { years: app.years, month: app.month }),
							`${stem}-plan.png`
						)
					)}
			>
				Planritning som PNG
			</button>
			<button
				type="button"
				role="menuitem"
				class="block w-full rounded px-2 py-1.5 text-left text-[12px] text-sage hover:bg-line hover:text-chalk"
				onclick={() =>
					run('Fasadvy', async () =>
						downloadBlob(
							await exportElevationPng(app.doc, {
								years: app.years,
								month: app.month,
								facing: app.facing
							}),
							`${stem}-fasad-${app.facing}.png`
						)
					)}
			>
				Fasadvy som PNG
			</button>
			<button
				type="button"
				role="menuitem"
				class="block w-full rounded px-2 py-1.5 text-left text-[12px] text-sage hover:bg-line hover:text-chalk disabled:opacity-40"
				disabled={!sceneCanvas}
				onclick={() =>
					run('Vybild', async () => {
						const grab = app.sceneCapture?.(2) ?? sceneCanvas;
						if (grab) downloadBlob(await exportViewPng(grab, 1), `${stem}-vy.png`);
					})}
			>
				3D-vyn som PNG
			</button>
			<button
				type="button"
				role="menuitem"
				class="block w-full rounded px-2 py-1.5 text-left text-[12px] text-sage hover:bg-line hover:text-chalk"
				onclick={() =>
					run('PDF', async () =>
						downloadBlob(
							await exportPdf(app.doc, {
								includeView: !!sceneCanvas,
								viewCanvas: sceneCanvas,
								elevations: app.terrainOn ? ([app.facing] as const) : []
							}),
							`${stem}.pdf`
						)
					)}
			>
				Ritning och växtlista som PDF
			</button>

			<div class="my-1 h-px bg-line"></div>

			<button
				type="button"
				role="menuitem"
				class="block w-full rounded px-2 py-1.5 text-left text-[12px] text-sage hover:bg-line hover:text-chalk"
				onclick={() => {
					text(`${stem}-vaxtlista.csv`, plantingListCsv(app.doc));
					open = false;
				}}
			>
				Växtlista som CSV
			</button>
			<button
				type="button"
				role="menuitem"
				class="block w-full rounded px-2 py-1.5 text-left text-[12px] text-sage hover:bg-line hover:text-chalk"
				onclick={() => {
					text(`${stem}-mangder.csv`, takeoffCsv(app.doc));
					open = false;
				}}
			>
				Mängder som CSV
			</button>
		</div>
	{/if}
</div>
