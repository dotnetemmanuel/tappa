import type { Doc, EntityId } from '../doc/types.js';

/**
 * What a command touched. Renderers rebuild only what a patch names, so a
 * command that moves one plant must not report `all`.
 */
export type Patch = {
	entities?: ReadonlySet<EntityId>;
	nodes?: boolean;
	plot?: boolean;
	layers?: boolean;
	meta?: boolean;
	assets?: boolean;
	all?: boolean;
};

export const PATCH_ALL: Patch = { all: true };

export function mergePatch(a: Patch, b: Patch): Patch {
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

export const touched = (...ids: EntityId[]): Patch => ({ entities: new Set(ids) });

/**
 * Commands mutate the document in place and know how to put it back.
 * `apply` must capture whatever `invert` will need before it changes anything.
 */
export interface Command {
	readonly label: string;
	apply(doc: Doc): Patch;
	invert(doc: Doc): Patch;
	/**
	 * Fold a follow-on command into this one, so a drag lands in the undo
	 * stack as a single step. Return null to keep them separate.
	 */
	coalesce?(next: Command): Command | null;
}
