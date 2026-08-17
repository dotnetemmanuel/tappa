<script lang="ts">
	import { onMount } from 'svelte';
	import { AddEntities } from '$lib/core/cmd/edits.js';
	import { makeImage } from '$lib/core/doc/factory.js';
	import { defaultScale, imagesFrom, ingestImage } from '$lib/io/image.js';
	import { preloadAssets, putImage } from '$lib/io/imagecache.js';
	import { migrate } from '$lib/io/migrate.js';
	import { getKV, isStorageAvailable, loadProject, saveProject, setKV } from '$lib/io/store.js';
	import { toWorld } from '$lib/render2d/view.js';
	import { AppState, TOOLS } from '$lib/ui/app.svelte.js';
	import { PlanController } from '$lib/ui/plan.svelte.js';
	import CalibrationBar from '$lib/ui/CalibrationBar.svelte';
	import Inspector from '$lib/ui/Inspector.svelte';
	import LayerPanel from '$lib/ui/LayerPanel.svelte';
	import MaterialPalette from '$lib/ui/MaterialPalette.svelte';
	import ElevationView from '$lib/ui/ElevationView.svelte';
	import PlanCanvas from '$lib/ui/PlanCanvas.svelte';
	import PlantPalette from '$lib/ui/PlantPalette.svelte';
	import Shortcuts from '$lib/ui/Shortcuts.svelte';
	import StatusBar from '$lib/ui/StatusBar.svelte';
	import TimeControls from '$lib/ui/TimeControls.svelte';
	import Toolbar from '$lib/ui/Toolbar.svelte';
	import TopBar from '$lib/ui/TopBar.svelte';

	const app = new AppState();
	const plan = new PlanController(app);

	let panelOpen = $state(true);
	let restored = $state(false);
	let shortcutsOpen = $state(false);
	let dropping = $state(false);
	let shell = $state<HTMLElement | null>(null);
	// three.js is a third of the bundle, so the 3D view only loads once it is asked for.
	let SceneView = $state<typeof import('$lib/ui/SceneView.svelte').default | null>(null);
	let sceneFailed = $state(false);

	$effect(() => {
		if (app.viewMode === 'plan' || SceneView || sceneFailed) return;
		import('$lib/ui/SceneView.svelte').then(
			(m) => (SceneView = m.default),
			() => (sceneFailed = true)
		);
	});

	// A reopened project has asset records but no decoded bitmaps, so the underlay
	// would draw as an empty outline until something pulls them back out of storage.
	$effect(() => {
		void app.rev;
		const ids = app.doc.assets.map((a) => a.id);
		if (ids.length === 0) return;
		preloadAssets(ids, (id) => app.doc.assets.find((a) => a.id === id)?.hash ?? null);
	});

	const isEmpty = $derived.by(() => {
		void app.rev;
		return app.doc.entities.length === 0 && app.doc.plot.boundary.length === 0 && !plan.draft;
	});

	const showsPlants = $derived(app.tool === 'plant' || app.tool === 'prop');
	const NUDGE = 0.1;

	function onKeyDown(ev: KeyboardEvent): void {
		const el = ev.target as HTMLElement | null;
		const typing =
			!!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.isContentEditable);

		if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
			ev.preventDefault();
			if (ev.shiftKey) app.redo();
			else app.undo();
			return;
		}
		if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'a' && !typing) {
			ev.preventDefault();
			app.select(app.doc.entities.map((e) => e.id));
			return;
		}
		if (typing) return;

		if (ev.key === '?') {
			ev.preventDefault();
			shortcutsOpen = !shortcutsOpen;
			return;
		}
		if (plan.keyDown(ev)) {
			ev.preventDefault();
			return;
		}
		if (ev.key === 'Delete') {
			ev.preventDefault();
			plan.deleteSelection();
			return;
		}
		if (ev.key.startsWith('Arrow')) {
			const step = ev.shiftKey ? NUDGE * 10 : NUDGE;
			const by = {
				ArrowLeft: { x: -step, y: 0 },
				ArrowRight: { x: step, y: 0 },
				ArrowUp: { x: 0, y: step },
				ArrowDown: { x: 0, y: -step }
			}[ev.key];
			if (by) {
				ev.preventDefault();
				plan.nudge(by);
			}
			return;
		}
		if (ev.key === '0') {
			ev.preventDefault();
			app.zoomToFit();
			return;
		}
		const tool = TOOLS.find((t) => t.key === ev.key.toLowerCase());
		if (tool && !ev.ctrlKey && !ev.metaKey) {
			ev.preventDefault();
			app.setTool(tool.id);
		}
	}

	/** A dropped or pasted picture lands where the pointer is, locked, behind everything. */
	async function addImages(files: File[], at?: { x: number; y: number }): Promise<void> {
		for (const file of files) {
			try {
				const { asset, bitmap } = await ingestImage(file, file.name);
				if (!app.doc.assets.some((a) => a.id === asset.id)) app.doc.assets.push(asset);
				putImage(asset.id, bitmap);
				const where = at ?? { x: app.view.centre.x, y: app.view.centre.y };
				const e = makeImage(asset.id, where, defaultScale(bitmap));
				app.history.run(new AddEntities([e], 'Bild'));
				app.select([e.id]);
				app.status =
					'Sätt skalan i panelen. Bilden är låst, tryck I och klicka på den för att välja den igen.';
			} catch (err) {
				app.status = err instanceof Error ? err.message : 'Kunde inte läsa bilden';
			}
		}
	}

	function onDrop(ev: DragEvent): void {
		dropping = false;
		const files = imagesFrom(ev);
		if (files.length === 0) return;
		ev.preventDefault();
		const rect = shell?.getBoundingClientRect();
		const at = rect
			? toWorld(app.view, { x: ev.clientX - rect.left - 56, y: ev.clientY - rect.top - 44 })
			: undefined;
		addImages(files, at);
	}

	onMount(() => {
		// Only the hint, not the tool: resetting it here would clobber a tool the
		// user picked while the page was still starting up.
		app.status = TOOLS[0].hint;
		let timer: ReturnType<typeof setTimeout> | null = null;

		(async () => {
			if (!isStorageAvailable()) {
				restored = true;
				return;
			}
			const id = (await getKV<string>('lastProject')) ?? crypto.randomUUID();
			app.projectId = id;
			const saved = await loadProject(id);
			if (saved) {
				try {
					app.loadDoc(migrate(saved));
				} catch {
					app.status = 'Det sparade projektet gick inte att läsa, börjar om.';
				}
			}
			await setKV('lastProject', id);
			restored = true;
		})();

		const stop = app.history.subscribe(() => {
			if (!restored || !isStorageAvailable() || !app.projectId) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				saveProject(app.projectId, app.doc).then(
					() => (app.dirty = false),
					() => (app.status = 'Kunde inte spara lokalt, exportera en fil för säkerhets skull.')
				);
			}, 1200);
		});

		const onPaste = (ev: ClipboardEvent) => {
			const files = imagesFrom(ev);
			if (files.length > 0) addImages(files);
		};
		window.addEventListener('paste', onPaste);

		return () => {
			stop();
			window.removeEventListener('paste', onPaste);
			if (timer) clearTimeout(timer);
		};
	});
</script>

<svelte:window onkeydown={onKeyDown} />

<div
	class="flex h-screen flex-col bg-ink"
	bind:this={shell}
	ondragover={(e) => {
		e.preventDefault();
		dropping = true;
	}}
	ondragleave={() => (dropping = false)}
	ondrop={onDrop}
	role="application"
	aria-label="Täppa"
>
	<TopBar {app} />

	<div class="flex min-h-0 flex-1">
		<Toolbar {app} />

		<!-- The drawing lies on the chrome like a sheet on a blackboard, which is the whole look. -->
		<main class="relative flex min-w-0 flex-1 gap-2 p-2">
			{#if app.viewMode === 'elevation'}
				<div class="min-w-0 flex-1 overflow-hidden rounded-lg shadow-[var(--lift-sheet)]">
					<ElevationView {app} />
				</div>
			{/if}

			{#if app.viewMode !== 'scene' && app.viewMode !== 'elevation'}
				<div class="relative min-w-0 flex-1 overflow-hidden rounded-lg shadow-[var(--lift-sheet)]">
					<PlanCanvas {app} {plan} />

					{#if isEmpty}
						<div class="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
							<div
								class="max-w-sm rounded-xl border border-line bg-bark/95 p-6 shadow-[var(--lift-pop)] backdrop-blur"
							>
								<h1 class="heading mb-3 text-[19px] text-chalk">Börja med tomtgränsen</h1>
								<p class="mb-3 text-[13px] leading-relaxed text-sage">
									Välj Tomtgräns i verktygsraden, klicka ut hörnen, och tryck Enter. Medan du ritar
									kan du skriva in exakt längd och vinkel och trycka Enter för att låsa sträckan.
								</p>
								<p class="mb-3 text-[13px] leading-relaxed text-sage">
									Har du en karta eller en flygbild? Släpp den här, sätt skalan mot något du vet
									längden på, och rita av tomten ovanpå.
								</p>
								<p class="num text-[12px] text-sage">Tryck ? för alla kortkommandon</p>
							</div>
						</div>
					{/if}

					<CalibrationBar {plan} />
				</div>
			{/if}

			{#if app.viewMode !== 'plan' && app.viewMode !== 'elevation'}
				<div class="min-w-0 flex-1 overflow-hidden rounded-lg shadow-[var(--lift-sheet)]">
					{#if SceneView}
						<SceneView {app} />
					{:else if sceneFailed}
						<p class="p-6 text-[13px] text-sage">3D-vyn gick inte att ladda.</p>
					{:else}
						<p class="p-6 text-[13px] text-sage">Laddar 3D…</p>
					{/if}
				</div>
			{/if}

			<div
				class="absolute top-4 right-4 flex gap-0.5 rounded-lg border border-line bg-bark/95 p-1 shadow-[var(--lift-pop)] backdrop-blur"
			>
				{#each [['plan', 'Plan'], ['split', 'Delad'], ['scene', '3D'], ['elevation', 'Fasad']] as const as [mode, label] (mode)}
					<button
						type="button"
						class="rounded px-2 py-1 text-[12px] transition-colors"
						class:bg-seed={app.viewMode === mode}
						class:text-ink={app.viewMode === mode}
						class:text-sage={app.viewMode !== mode}
						aria-pressed={app.viewMode === mode}
						onclick={() => (app.viewMode = mode)}
					>
						{label}
					</button>
				{/each}
				<button
					type="button"
					class="rounded px-2 py-1 text-[12px] text-sage hover:text-chalk lg:hidden"
					onclick={() => (panelOpen = !panelOpen)}
				>
					{panelOpen ? 'Dölj' : 'Panel'}
				</button>
			</div>

			{#if dropping}
				<div
					class="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-seed bg-ink/70"
				>
					<p class="text-[14px] text-chalk">Släpp bilden för att lägga den under ritningen</p>
				</div>
			{/if}
		</main>

		<aside
			class="flex w-[17rem] shrink-0 flex-col overflow-y-auto border-l border-line bg-bark max-lg:absolute max-lg:bottom-8 max-lg:right-0 max-lg:top-11 max-lg:z-30"
			class:max-lg:hidden={!panelOpen}
		>
			{#if showsPlants}
				<PlantPalette {app} />
			{:else}
				<MaterialPalette {app} />
			{/if}
			<TimeControls {app} />
			<LayerPanel {app} />
			<Inspector {app} {plan} />
		</aside>
	</div>

	<StatusBar {app} {plan} />
</div>

<Shortcuts bind:open={shortcutsOpen} />
