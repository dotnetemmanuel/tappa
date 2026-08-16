import type { Vec2 } from '../geom/vec2.js';
import type { Doc, DocMeta, Entity, EntityId, Layer, LayerId, NodeId } from '../doc/types.js';
import { PATCH_ALL, touched, type Command, type Patch } from './command.js';

const deep = <T>(x: T): T => structuredClone(x);

export class AddEntities implements Command {
	readonly label: string;
	private readonly items: Entity[];

	constructor(items: Entity[], label = items.length > 1 ? 'Lägg till objekt' : 'Lägg till objekt') {
		this.items = items.map(deep);
		this.label = label;
	}

	apply(doc: Doc): Patch {
		doc.entities.push(...this.items.map(deep));
		return touched(...this.items.map((e) => e.id));
	}

	invert(doc: Doc): Patch {
		const ids = new Set(this.items.map((e) => e.id));
		doc.entities = doc.entities.filter((e) => !ids.has(e.id));
		return { entities: ids };
	}
}

export class RemoveEntities implements Command {
	readonly label = 'Ta bort';
	private readonly ids: EntityId[];
	/** Index and value of each removed entity, so undo restores draw order. */
	private removed: { at: number; e: Entity }[] = [];

	constructor(ids: EntityId[]) {
		this.ids = [...ids];
	}

	apply(doc: Doc): Patch {
		const wanted = new Set(this.ids);
		this.removed = [];
		const kept: Entity[] = [];
		doc.entities.forEach((e, i) => {
			if (wanted.has(e.id)) this.removed.push({ at: i, e: deep(e) });
			else kept.push(e);
		});
		doc.entities = kept;
		return { entities: wanted };
	}

	invert(doc: Doc): Patch {
		for (const { at, e } of this.removed) doc.entities.splice(at, 0, deep(e));
		return { entities: new Set(this.removed.map((r) => r.e.id)) };
	}
}

/** The workhorse edit: swap whole entities, remembering what they were. */
export class ReplaceEntities implements Command {
	readonly label: string;
	private readonly next: Entity[];
	private before: Entity[] = [];

	constructor(next: Entity[], label = 'Ändra') {
		this.next = next.map(deep);
		this.label = label;
	}

	apply(doc: Doc): Patch {
		const byId = new Map(this.next.map((e) => [e.id, e]));
		this.before = [];
		doc.entities = doc.entities.map((e) => {
			const n = byId.get(e.id);
			if (!n) return e;
			this.before.push(deep(e));
			return deep(n);
		});
		return { entities: new Set(byId.keys()) };
	}

	invert(doc: Doc): Patch {
		const byId = new Map(this.before.map((e) => [e.id, e]));
		doc.entities = doc.entities.map((e) => {
			const b = byId.get(e.id);
			return b ? deep(b) : e;
		});
		return { entities: new Set(byId.keys()) };
	}

	coalesce(next: Command): Command | null {
		if (!(next instanceof ReplaceEntities)) return null;
		const mine = new Set(this.next.map((e) => e.id));
		if (next.next.length !== mine.size || !next.next.every((e) => mine.has(e.id))) return null;
		const folded = new ReplaceEntities(next.next, this.label);
		folded.before = this.before;
		return folded;
	}
}

export class SetPlotBoundary implements Command {
	readonly label = 'Tomtgräns';
	private before: Vec2[] = [];

	constructor(private readonly ring: Vec2[]) {}

	apply(doc: Doc): Patch {
		this.before = deep(doc.plot.boundary);
		doc.plot.boundary = deep(this.ring);
		return { plot: true };
	}

	invert(doc: Doc): Patch {
		doc.plot.boundary = deep(this.before);
		return { plot: true };
	}
}

export class SetNodes implements Command {
	readonly label = 'Flytta hörn';
	private before: Record<NodeId, Vec2> = {};

	constructor(private readonly next: Record<NodeId, Vec2>) {}

	apply(doc: Doc): Patch {
		this.before = {};
		for (const [id, p] of Object.entries(this.next)) {
			if (doc.nodes[id]) this.before[id] = { ...doc.nodes[id] };
			doc.nodes[id] = { ...p };
		}
		return { nodes: true };
	}

	invert(doc: Doc): Patch {
		for (const id of Object.keys(this.next)) {
			const b = this.before[id];
			if (b) doc.nodes[id] = { ...b };
			else delete doc.nodes[id];
		}
		return { nodes: true };
	}

	coalesce(next: Command): Command | null {
		if (!(next instanceof SetNodes)) return null;
		const mine = Object.keys(this.next).sort().join();
		if (Object.keys(next.next).sort().join() !== mine) return null;
		const folded = new SetNodes(next.next);
		folded.before = this.before;
		return folded;
	}
}

export class SetLayers implements Command {
	readonly label = 'Lager';
	private before: Layer[] = [];

	constructor(private readonly next: Layer[]) {}

	apply(doc: Doc): Patch {
		this.before = deep(doc.layers);
		doc.layers = deep(this.next);
		return { layers: true, all: true };
	}

	invert(doc: Doc): Patch {
		doc.layers = deep(this.before);
		return { layers: true, all: true };
	}
}

export class SetMeta implements Command {
	readonly label = 'Projektuppgifter';
	private before: DocMeta | null = null;

	constructor(private readonly patch: Partial<DocMeta>) {}

	apply(doc: Doc): Patch {
		this.before = deep(doc.meta);
		doc.meta = { ...doc.meta, ...this.patch };
		return { meta: true };
	}

	invert(doc: Doc): Patch {
		if (this.before) doc.meta = deep(this.before);
		return { meta: true };
	}
}

/** Several edits that undo as one step. */
export class Batch implements Command {
	constructor(
		readonly label: string,
		private readonly parts: Command[]
	) {}

	apply(doc: Doc): Patch {
		let p: Patch = {};
		for (const c of this.parts) p = mergeInto(p, c.apply(doc));
		return p;
	}

	invert(doc: Doc): Patch {
		let p: Patch = {};
		for (let i = this.parts.length - 1; i >= 0; i--) p = mergeInto(p, this.parts[i].invert(doc));
		return p;
	}
}

function mergeInto(a: Patch, b: Patch): Patch {
	if (a.all || b.all) return PATCH_ALL;
	const entities =
		a.entities || b.entities ? new Set([...(a.entities ?? []), ...(b.entities ?? [])]) : undefined;
	return {
		entities,
		nodes: a.nodes || b.nodes,
		plot: a.plot || b.plot,
		layers: a.layers || b.layers,
		meta: a.meta || b.meta,
		assets: a.assets || b.assets
	};
}

export function entitiesOnLayer(doc: Doc, layer: LayerId): Entity[] {
	return doc.entities.filter((e) => e.layer === layer);
}
