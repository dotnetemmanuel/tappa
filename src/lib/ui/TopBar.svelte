<script lang="ts">
	import { SetMeta } from '../core/cmd/edits.js';
	import { createDoc } from '../core/doc/doc.js';
	import { packTappa, suggestFilename, unpackTappa, type AssetBlob } from '../io/tappa.js';
	import { getAsset, putAsset, setKV } from '../io/store.js';
	import { putImage } from '../io/imagecache.js';
	import ExportMenu from './ExportMenu.svelte';
	import type { AppState } from './app.svelte.js';

	let { app }: { app: AppState } = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let notice = $state('');
	let busy = $state(false);

	const projectName = $derived.by(() => {
		void app.rev;
		return app.doc.meta.name;
	});

	/** The picture bytes travel inside the file, or an underlay does not survive a move. */
	async function collectAssets(): Promise<AssetBlob[]> {
		const out: AssetBlob[] = [];
		for (const a of app.doc.assets) {
			const blob = await getAsset(a.hash);
			if (!blob) continue;
			out.push({ id: a.id, mime: a.mime, bytes: new Uint8Array(await blob.arrayBuffer()) });
		}
		return out;
	}

	async function exportTappa(): Promise<void> {
		busy = true;
		try {
			const bytes = packTappa(app.doc, await collectAssets());
			const buf = new ArrayBuffer(bytes.byteLength);
			new Uint8Array(buf).set(bytes);
			const url = URL.createObjectURL(new Blob([buf], { type: 'application/zip' }));
			const a = document.createElement('a');
			a.href = url;
			a.download = suggestFilename(app.doc);
			a.click();
			URL.revokeObjectURL(url);
			app.dirty = false;
		} catch (err) {
			notice = err instanceof Error ? err.message : 'Kunde inte spara filen';
		} finally {
			busy = false;
		}
	}

	/** A new project needs its own id, or autosave writes the blank one over the old. */
	async function newProject(): Promise<void> {
		app.loadDoc(createDoc());
		app.projectId = crypto.randomUUID();
		await setKV('lastProject', app.projectId);
	}

	async function importTappa(file: File): Promise<void> {
		busy = true;
		try {
			const { doc, assets } = unpackTappa(new Uint8Array(await file.arrayBuffer()));
			// An imported project is its own project, not an overwrite of the open one.
			app.projectId = crypto.randomUUID();
			await setKV('lastProject', app.projectId);
			for (const a of assets) {
				const ref = doc.assets.find((x) => x.id === a.id);
				if (!ref) continue;
				const blob = new Blob([a.bytes.slice().buffer], { type: a.mime });
				ref.hash = await putAsset(blob, { mime: a.mime, w: ref.w, h: ref.h });
				if (typeof createImageBitmap === 'function') {
					putImage(a.id, await createImageBitmap(blob, { imageOrientation: 'from-image' }));
				}
			}
			app.loadDoc(doc);
			notice = '';
		} catch (err) {
			notice = err instanceof Error ? err.message : 'Kunde inte läsa filen';
		} finally {
			busy = false;
		}
	}
</script>

<header class="flex h-11 shrink-0 items-center gap-2 bg-ink px-3">
	<span class="heading text-[17px] text-seed">Täppa</span>

	<!-- The project name is text you can just type over, so it carries no box until you touch it. -->
	<input
		class="ml-3 w-52 rounded-md border border-transparent bg-transparent px-2 text-[13px] text-chalk hover:border-line hover:bg-bark focus:border-line focus:bg-bark"
		value={projectName}
		aria-label="Projektets namn"
		onchange={(e) => app.history.run(new SetMeta({ name: e.currentTarget.value }))}
	/>

	<div class="ml-1 flex items-center gap-0.5">
		<button
			type="button"
			class="rounded-md px-2 py-1 text-[12px] text-sage transition-colors enabled:hover:bg-bark enabled:hover:text-chalk disabled:opacity-35"
			disabled={!app.canUndo}
			title="Ångra (Ctrl+Z)"
			onclick={() => app.undo()}
		>
			Ångra
		</button>
		<button
			type="button"
			class="rounded-md px-2 py-1 text-[12px] text-sage transition-colors enabled:hover:bg-bark enabled:hover:text-chalk disabled:opacity-35"
			disabled={!app.canRedo}
			title="Gör om (Ctrl+Shift+Z)"
			onclick={() => app.redo()}
		>
			Gör om
		</button>
	</div>

	<div class="ml-auto flex items-center gap-1">
		{#if notice}
			<span class="mr-2 text-[12px] text-[#c2543a]">{notice}</span>
		{:else if app.dirty}
			<span class="mr-2 text-[11px] text-sage">Sparar lokalt</span>
		{/if}

		<button
			type="button"
			class="rounded-md p-1.5 text-sage transition-colors hover:bg-bark hover:text-chalk"
			title={app.theme === 'dark' ? 'Byt till ljust' : 'Byt till mörkt'}
			aria-label={app.theme === 'dark' ? 'Byt till ljust utseende' : 'Byt till mörkt utseende'}
			onclick={() => (app.theme = app.theme === 'dark' ? 'light' : 'dark')}
		>
			<svg viewBox="0 0 18 18" class="h-4 w-4" aria-hidden="true">
				{#if app.theme === 'dark'}
					<circle cx="9" cy="9" r="3.4" fill="none" stroke="currentColor" stroke-width="1.4" />
					<path
						d="M9 1.6v1.8M9 14.6v1.8M1.6 9h1.8M14.6 9h1.8M3.8 3.8l1.3 1.3M12.9 12.9l1.3 1.3M14.2 3.8l-1.3 1.3M5.1 12.9l-1.3 1.3"
						stroke="currentColor"
						stroke-width="1.4"
						stroke-linecap="round"
					/>
				{:else}
					<path
						d="M14.5 11.2A6 6 0 0 1 6.8 3.5a6 6 0 1 0 7.7 7.7Z"
						fill="none"
						stroke="currentColor"
						stroke-width="1.4"
						stroke-linejoin="round"
					/>
				{/if}
			</svg>
		</button>

		<span class="mx-1 h-4 w-px bg-line"></span>

		<button
			type="button"
			class="rounded-md px-2.5 py-1 text-[12px] text-sage transition-colors hover:bg-bark hover:text-chalk"
			onclick={newProject}
		>
			Nytt
		</button>
		<button
			type="button"
			class="rounded-md px-2.5 py-1 text-[12px] text-sage transition-colors hover:bg-bark hover:text-chalk"
			onclick={() => fileInput?.click()}
		>
			Öppna
		</button>
		<ExportMenu {app} sceneCanvas={app.sceneCanvas} />
		<button
			type="button"
			class="rounded-md bg-seed px-3 py-1 text-[12px] font-medium text-ink shadow-[var(--lift-card)] transition-[filter] hover:brightness-110 disabled:opacity-60"
			disabled={busy}
			onclick={exportTappa}
		>
			{busy ? 'Sparar…' : 'Spara fil'}
		</button>
	</div>

	<input
		bind:this={fileInput}
		type="file"
		accept=".tappa,application/zip"
		class="hidden"
		onchange={(e) => {
			const f = e.currentTarget.files?.[0];
			if (f) importTappa(f);
			e.currentTarget.value = '';
		}}
	/>
</header>
