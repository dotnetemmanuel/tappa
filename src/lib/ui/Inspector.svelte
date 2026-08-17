<script lang="ts">
	import { AddEntities, ReplaceEntities } from '../core/cmd/edits.js';
	import { runChecks } from '../core/analysis/checks.js';
	import { dimGeometry, formatArea, formatLength } from '../core/doc/dimension.js';
	import { entityRing, findEntity } from '../core/doc/doc.js';
	import { makeRoof } from '../core/doc/factory.js';
	import { LINE_STYLES, MATERIALS, material } from '../core/doc/materials.js';
	import type { AreaEntity, Entity, Opening, WallEntity } from '../core/doc/types.js';
	import { area, pathLength, perimeter } from '../core/geom/polygon.js';
	import { speciesOr } from '../core/plants/catalog.js';
	import { sizeAt } from '../core/plants/growth.js';
	import { propDefOr } from '../core/props/catalog.js';
	import { paramsFor } from '../core/props/builders.js';
	import { groundUnder } from '../core/terrain/query.js';
	import { wallLoops } from '../core/building/wallgraph.js';
	import { DEFAULT_DOOR, DEFAULT_WINDOW } from '../core/building/openings.js';
	import { nextId } from '../core/doc/ids.js';
	import type { AppState } from './app.svelte.js';
	import type { PlanController } from './plan.svelte.js';

	let { app, plan }: { app: AppState; plan: PlanController } = $props();

	const selected = $derived.by((): Entity[] => {
		void app.rev;
		return app.selection.map((id) => findEntity(app.doc, id)).filter((e): e is Entity => !!e);
	});
	const one = $derived(selected.length === 1 ? selected[0] : null);
	const walls = $derived(selected.filter((e) => e.k === 'wall'));

	const KIND_SV: Record<Entity['k'], string> = {
		area: 'Yta',
		path: 'Gång',
		line: 'Linje',
		wall: 'Vägg',
		roof: 'Tak',
		spot: 'Marknivå',
		plant: 'Växt',
		prop: 'Föremål',
		image: 'Bild',
		dim: 'Mått',
		label: 'Text'
	};

	function edit(next: Entity, label: string): void {
		app.history.run(new ReplaceEntities([next], label));
	}

	/** A new terrace starts at the ground it covers, so the first number is already close. */
	function groundLevelUnder(e: AreaEntity): number {
		const g = groundUnder(app.field, e.ring);
		return Math.round(((g.min + g.max) / 2) * 100) / 100;
	}

	const num = (v: string, fallback: number): number => {
		const n = Number(v.replace(',', '.'));
		return Number.isFinite(n) ? n : fallback;
	};

	const measure = $derived.by(() => {
		void app.rev;
		if (!one) return null;
		if (one.k === 'area')
			return {
				a: formatArea(area(one.ring) - (one.holes ?? []).reduce((s, h) => s + area(h), 0)),
				p: formatLength(perimeter(one.ring))
			};
		if (one.k === 'path') {
			const ring = entityRing(app.doc, one);
			return { a: ring ? formatArea(area(ring)) : null, p: formatLength(pathLength(one.spine)) };
		}
		if (one.k === 'line') return { a: null, p: formatLength(pathLength(one.spine)) };
		if (one.k === 'dim') {
			const g = dimGeometry(app.doc, one);
			return g ? { a: null, p: formatLength(g.value) } : null;
		}
		if (one.k === 'wall') {
			const a = app.doc.nodes[one.a];
			const b = app.doc.nodes[one.b];
			return a && b ? { a: null, p: formatLength(Math.hypot(b.x - a.x, b.y - a.y)) } : null;
		}
		return null;
	});

	const plantInfo = $derived.by(() => {
		void app.rev;
		if (!one || one.k !== 'plant') return null;
		const sp = speciesOr(one.species);
		const age = Math.max(0, app.years - (one.plantedYear ?? 0));
		return { sp, age, size: sizeAt(sp, age, one.sizeJitter) };
	});

	const myChecks = $derived.by(() => {
		void app.rev;
		if (!one || !app.showChecks) return [];
		return runChecks(app.doc, {
			years: app.years,
			month: app.month,
			shadow: app.shadow,
			field: app.field
		}).filter((c) => c.entity === one.id || c.other === one.id);
	});

	/** One number for the whole house: written to every wall in the connected run. */
	function setFloor(wall: WallEntity, floor: number): void {
		const loop = wallLoops(app.doc).find((l) => l.walls.some((w) => w.id === wall.id));
		const walls = loop ? loop.walls : [wall];
		app.history.run(
			new ReplaceEntities(
				walls.map((w) => ({ ...w, floor })),
				'Golvnivå'
			)
		);
	}

	/** How much of the base storey stands clear of the ground, for the house this wall belongs to. */
	const houseBase = $derived.by((): number | null => {
		void app.rev;
		if (!one || one.k !== 'wall' || !app.field) return null;
		const loop = wallLoops(app.doc).find((l) => l.walls.some((w) => w.id === one.id));
		if (!loop) return null;
		const ground = groundUnder(app.field, loop.ring);
		const exposed = (one.floor ?? 0) - ground.min;
		return exposed > 0.05 ? exposed : null;
	});

	/** True when an earlier opening already carried the lower plan heading. */
	function belowShown(wall: WallEntity, i: number): boolean {
		return wall.openings.slice(0, i).some((o) => o.sill < 0);
	}

	function addOpening(type: 'door' | 'window'): void {
		if (!one || one.k !== 'wall') return;
		const d = type === 'door' ? DEFAULT_DOOR : DEFAULT_WINDOW;
		const opening: Opening = { id: nextId('op'), type, t: 0.5, ...d };
		edit({ ...one, openings: [...one.openings, opening] }, 'Öppning');
	}

	function roofOverSelection(): void {
		if (walls.length === 0) return;
		const roof = makeRoof(
			walls.map((w) => w.id),
			'gable',
			27,
			0
		);
		app.history.run(new AddEntities([roof], 'Tak'));
		app.select([roof.id]);
	}
</script>

<section class="card p-3">
	<h2 class="card-title mb-2.5">Egenskaper</h2>

	{#if selected.length === 0}
		<p class="text-[12px] leading-relaxed text-sage">
			Inget är valt. Välj något på ritningen för att ändra det.
		</p>
	{:else if selected.length > 1}
		<p class="num mb-2 text-[12px] text-sage">{selected.length} objekt valda</p>
		{#if walls.length >= 2}
			<button
				type="button"
				class="h-[var(--control-h)] w-full rounded-md border border-line bg-ink text-[12px] text-chalk transition-colors hover:border-seed hover:text-seed"
				onclick={roofOverSelection}
			>
				Lägg tak över {walls.length} väggar
			</button>
		{/if}
	{:else if one}
		<dl class="space-y-2 text-[12px]">
			<div class="flex items-baseline justify-between gap-2">
				<dt class="text-sage">Typ</dt>
				<dd class="text-chalk">{KIND_SV[one.k]}</dd>
			</div>

			{#if measure?.p}
				<div class="flex items-baseline justify-between gap-2">
					<dt class="text-sage">{one.k === 'area' ? 'Omkrets' : 'Längd'}</dt>
					<dd class="num text-chalk">{measure.p}</dd>
				</div>
			{/if}
			{#if measure?.a}
				<div class="flex items-baseline justify-between gap-2">
					<dt class="text-sage">Area</dt>
					<dd class="num text-chalk">{measure.a}</dd>
				</div>
			{/if}

			{#if one.k === 'area' || one.k === 'path'}
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Material</span>
					<select
						class="w-32"
						value={one.mat.id}
						onchange={(e) =>
							edit({ ...one, mat: { ...one.mat, id: e.currentTarget.value } }, 'Material')}
					>
						{#each MATERIALS as m (m.id)}
							<option value={m.id}>{m.sv}</option>
						{/each}
					</select>
				</label>
				<p class="text-[11px] text-sage">{material(one.mat.id).en}</p>
			{/if}

			{#if one.k === 'spot'}
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Höjd</span>
					<span class="flex items-center gap-1">
						<input
							class="num w-20 text-right"
							type="number"
							step="0.05"
							value={one.z}
							onchange={(e) => edit({ ...one, z: num(e.currentTarget.value, one.z) }, 'Marknivå')}
						/>
						<span class="num text-sage">m</span>
					</span>
				</label>
				<p class="text-[11px] text-sage">
					Plus är uppåt. Noll är den nivå du själv väljer som utgångspunkt.
				</p>
			{/if}

			{#if one.k === 'area'}
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Jämnar marken</span>
					<input
						type="checkbox"
						checked={!!one.grade}
						onchange={(e) =>
							edit(
								{
									...one,
									grade: e.currentTarget.checked
										? { level: groundLevelUnder(one), edge: 'wall', run: app.bankRun }
										: undefined
								},
								'Marknivå'
							)}
					/>
				</label>
				{#if one.grade}
					{@const grade = one.grade}
					<label class="flex items-center justify-between gap-2">
						<span class="text-sage">Nivå</span>
						<span class="flex items-center gap-1">
							<input
								class="num w-20 text-right"
								type="number"
								step="0.05"
								value={grade.level}
								onchange={(e) =>
									edit(
										{ ...one, grade: { ...grade, level: num(e.currentTarget.value, grade.level) } },
										'Nivå'
									)}
							/>
							<span class="num text-sage">m</span>
						</span>
					</label>
					<label class="flex items-center justify-between gap-2">
						<span class="text-sage">Kant</span>
						<select
							class="w-32"
							value={grade.edge}
							onchange={(e) =>
								edit(
									{
										...one,
										grade: { ...grade, edge: e.currentTarget.value === 'bank' ? 'bank' : 'wall' }
									},
									'Kant'
								)}
						>
							<option value="wall">Mur, rakt av</option>
							<option value="bank">Slänt</option>
						</select>
					</label>
					<label class="flex items-center justify-between gap-2">
						<span class="text-sage">Släntens bredd</span>
						<span class="flex items-center gap-1">
							<input
								class="num w-20 text-right"
								type="number"
								min="0.1"
								step="0.1"
								disabled={grade.edge !== 'bank'}
								value={grade.run}
								onchange={(e) => {
									const run = num(e.currentTarget.value, grade.run);
									app.bankRun = run;
									edit({ ...one, grade: { ...grade, run } }, 'Slänt');
								}}
							/>
							<span class="num text-sage">m</span>
						</span>
					</label>
				{/if}
			{/if}

			{#if one.k === 'path'}
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Bredd</span>
					<span class="flex items-center gap-1">
						<input
							class="num w-20 text-right"
							type="number"
							min="0.1"
							step="0.05"
							value={one.width}
							onchange={(e) =>
								edit({ ...one, width: num(e.currentTarget.value, one.width) }, 'Bredd')}
						/>
						<span class="num text-sage">m</span>
					</span>
				</label>
			{/if}

			{#if one.k === 'line'}
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Stil</span>
					<select
						class="w-32"
						value={one.style.id}
						onchange={(e) =>
							edit({ ...one, style: { ...one.style, id: e.currentTarget.value } }, 'Stil')}
					>
						{#each LINE_STYLES as s (s.id)}
							<option value={s.id}>{s.sv}</option>
						{/each}
					</select>
				</label>
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Höjd</span>
					<span class="flex items-center gap-1">
						<input
							class="num w-20 text-right"
							type="number"
							min="0.05"
							step="0.05"
							value={one.height}
							onchange={(e) =>
								edit({ ...one, height: num(e.currentTarget.value, one.height) }, 'Höjd')}
						/>
						<span class="num text-sage">m</span>
					</span>
				</label>
			{/if}

			{#if one.k === 'wall'}
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Tjocklek</span>
					<span class="flex items-center gap-1">
						<input
							class="num w-20 text-right"
							type="number"
							min="0.05"
							step="0.05"
							value={one.thickness}
							onchange={(e) =>
								edit({ ...one, thickness: num(e.currentTarget.value, one.thickness) }, 'Tjocklek')}
						/>
						<span class="num text-sage">m</span>
					</span>
				</label>
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Höjd</span>
					<span class="flex items-center gap-1">
						<input
							class="num w-20 text-right"
							type="number"
							min="0.5"
							step="0.1"
							value={one.height}
							onchange={(e) =>
								edit({ ...one, height: num(e.currentTarget.value, one.height) }, 'Höjd')}
						/>
						<span class="num text-sage">m</span>
					</span>
				</label>

				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Golvnivå</span>
					<span class="flex items-center gap-1">
						<input
							class="num w-20 text-right"
							type="number"
							step="0.05"
							value={one.floor ?? 0}
							onchange={(e) => setFloor(one, num(e.currentTarget.value, one.floor ?? 0))}
						/>
						<span class="num text-sage">m</span>
					</span>
				</label>
				{#if houseBase !== null}
					<p class="text-[11px] text-sage">
						Gäller hela huset. Souterrängvåningen syns {formatLength(houseBase)} som mest.
					</p>
				{/if}

				<div class="pt-1">
					<span class="mb-1 block text-sage">Öppningar ({one.openings.length})</span>
					<div class="flex gap-1">
						<button
							type="button"
							class="h-[var(--control-h)] flex-1 rounded-md border border-line bg-ink text-[12px] text-chalk transition-colors hover:border-seed hover:text-seed"
							onclick={() => addOpening('door')}
						>
							Dörr
						</button>
						<button
							type="button"
							class="h-[var(--control-h)] flex-1 rounded-md border border-line bg-ink text-[12px] text-chalk transition-colors hover:border-seed hover:text-seed"
							onclick={() => addOpening('window')}
						>
							Fönster
						</button>
					</div>
					{#each one.openings as op, i (op.id)}
						{#if op.sill < 0 && !belowShown(one, i)}
							<p class="mt-2 text-[11px] text-sage">Nedre plan</p>
						{/if}
						<div class="mt-1 flex items-center gap-1">
							<span class="w-14 shrink-0 text-[11px] text-sage">
								{op.type === 'door' ? 'Dörr' : 'Fönster'}
							</span>
							<input
								class="flex-1"
								type="range"
								min="0.05"
								max="0.95"
								step="0.01"
								value={op.t}
								oninput={(e) => {
									const openings = [...one.openings];
									openings[i] = { ...op, t: Number(e.currentTarget.value) };
									edit({ ...one, openings }, 'Flytta öppning');
								}}
							/>
							<button
								type="button"
								class="rounded px-1 text-sage hover:text-[#c2543a]"
								aria-label="Ta bort öppningen"
								onclick={() =>
									edit(
										{ ...one, openings: one.openings.filter((x) => x.id !== op.id) },
										'Ta bort öppning'
									)}
							>
								×
							</button>
						</div>
					{/each}
				</div>
			{/if}

			{#if one.k === 'roof'}
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Typ</span>
					<select
						class="w-32"
						value={one.type}
						onchange={(e) =>
							edit({ ...one, type: e.currentTarget.value as typeof one.type }, 'Taktyp')}
					>
						<option value="gable">Sadeltak</option>
						<option value="hip">Valmat</option>
						<option value="mono">Pulpettak</option>
						<option value="flat">Platt</option>
					</select>
				</label>
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Lutning</span>
					<span class="flex items-center gap-1">
						<input
							class="num w-20 text-right"
							type="number"
							min="0"
							max="60"
							step="1"
							value={one.pitchDeg}
							onchange={(e) =>
								edit({ ...one, pitchDeg: num(e.currentTarget.value, one.pitchDeg) }, 'Taklutning')}
						/>
						<span class="num text-sage">°</span>
					</span>
				</label>
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Nockriktning</span>
					<input
						class="flex-1"
						type="range"
						min="0"
						max="179"
						step="1"
						value={one.ridgeDeg}
						oninput={(e) => edit({ ...one, ridgeDeg: Number(e.currentTarget.value) }, 'Nock')}
					/>
				</label>
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Takutsprång</span>
					<span class="flex items-center gap-1">
						<input
							class="num w-20 text-right"
							type="number"
							min="0"
							step="0.05"
							value={one.overhang}
							onchange={(e) =>
								edit({ ...one, overhang: num(e.currentTarget.value, one.overhang) }, 'Utsprång')}
						/>
						<span class="num text-sage">m</span>
					</span>
				</label>
			{/if}

			{#if one.k === 'plant' && plantInfo}
				<div class="flex items-baseline justify-between gap-2">
					<dt class="text-sage">Art</dt>
					<dd class="text-right text-chalk">
						{plantInfo.sp.sv}
						<span class="block text-[10px] italic text-sage">{plantInfo.sp.latin}</span>
					</dd>
				</div>
				<div class="flex items-baseline justify-between gap-2">
					<dt class="text-sage">Nu ({plantInfo.age} år)</dt>
					<dd class="num text-chalk">
						{formatLength(plantInfo.size.h)} × {formatLength(plantInfo.size.w)}
					</dd>
				</div>
				<div class="flex items-baseline justify-between gap-2">
					<dt class="text-sage">Fullvuxen</dt>
					<dd class="num text-sage">
						{formatLength(plantInfo.sp.mature.h)} × {formatLength(plantInfo.sp.mature.w)}
					</dd>
				</div>
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Planterad år</span>
					<input
						class="num w-20 text-right"
						type="number"
						min="0"
						max="30"
						value={one.plantedYear}
						onchange={(e) =>
							edit(
								{ ...one, plantedYear: num(e.currentTarget.value, one.plantedYear) },
								'Planterad'
							)}
					/>
				</label>
			{/if}

			{#if one.k === 'prop'}
				{@const def = propDefOr(one.kind)}
				{@const params = paramsFor(def, one.params)}
				<div class="flex items-baseline justify-between gap-2">
					<dt class="text-sage">Sort</dt>
					<dd class="text-chalk">{def.sv}</dd>
				</div>
				{#each def.params as p (p.key)}
					<label class="flex items-center justify-between gap-2">
						<span class="text-sage">{p.sv}</span>
						<span class="flex items-center gap-1">
							<input
								class="num w-20 text-right"
								type="number"
								min={p.min}
								max={p.max}
								step={p.step}
								value={params[p.key]}
								onchange={(e) =>
									edit(
										{
											...one,
											params: { ...params, [p.key]: num(e.currentTarget.value, params[p.key]) }
										},
										def.sv
									)}
							/>
							<span class="num text-sage">m</span>
						</span>
					</label>
				{/each}
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Vridning</span>
					<input
						class="flex-1"
						type="range"
						min="0"
						max="360"
						step="5"
						value={Math.round(((one.rot ?? 0) * 180) / Math.PI)}
						oninput={(e) =>
							edit({ ...one, rot: (Number(e.currentTarget.value) * Math.PI) / 180 }, 'Vrid')}
					/>
				</label>
			{/if}

			{#if one.k === 'image'}
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Genomskinlighet</span>
					<input
						class="flex-1"
						type="range"
						min="0.1"
						max="1"
						step="0.05"
						value={one.opacity}
						oninput={(e) => edit({ ...one, opacity: Number(e.currentTarget.value) }, 'Bild')}
					/>
				</label>
				<label class="flex items-center justify-between gap-2">
					<span class="text-sage">Vridning</span>
					<input
						class="flex-1"
						type="range"
						min="0"
						max="360"
						step="1"
						value={Math.round((one.transform.rot * 180) / Math.PI)}
						oninput={(e) =>
							edit(
								{
									...one,
									transform: {
										...one.transform,
										rot: (Number(e.currentTarget.value) * Math.PI) / 180
									}
								},
								'Vrid bild'
							)}
					/>
				</label>
				<label class="flex items-center justify-between gap-2 text-sage">
					<span>Låst</span>
					<input
						type="checkbox"
						class="accent-[var(--color-seed)]"
						checked={one.locked ?? false}
						onchange={(e) => edit({ ...one, locked: e.currentTarget.checked }, 'Lås bild')}
					/>
				</label>
				<button
					type="button"
					class="w-full rounded bg-seed px-2 py-1 text-[12px] font-medium text-ink hover:brightness-110"
					onclick={() => plan.startCalibration(one.id)}
				>
					Sätt skala
				</button>
				<p class="text-[11px] leading-relaxed text-sage">
					Rita en linje över något du vet längden på, till exempel en tomtgräns eller ett staket,
					och skriv in måttet.
				</p>
			{/if}

			{#if one.k === 'label'}
				<label class="flex flex-col gap-1">
					<span class="text-sage">Text</span>
					<input
						class="rounded bg-ink px-1.5 py-1 text-chalk"
						value={one.text}
						onchange={(e) => edit({ ...one, text: e.currentTarget.value }, 'Text')}
					/>
				</label>
			{/if}

			{#if one.k === 'dim'}
				<label class="flex flex-col gap-1">
					<span class="text-sage">Egen text</span>
					<input
						class="rounded bg-ink px-1.5 py-1 text-chalk"
						placeholder="Mätt värde"
						value={one.text ?? ''}
						onchange={(e) => edit({ ...one, text: e.currentTarget.value || undefined }, 'Måttext')}
					/>
				</label>
			{/if}
		</dl>

		{#if myChecks.length > 0}
			<ul class="mt-3 space-y-1 border-t border-line pt-2">
				{#each myChecks as c (c.message)}
					<li class="text-[11px] leading-relaxed text-[#c2954a]">{c.message}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>
