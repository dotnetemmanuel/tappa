import type { Doc } from '../doc/types.js';
import { Batch } from './edits.js';
import { PATCH_ALL, mergePatch, type Command, type Patch } from './command.js';

export type HistoryListener = (patch: Patch) => void;

const LIMIT = 200;

/**
 * Undo stack over a mutable document. Nothing else may write to `doc`, so that
 * every change is reversible and every listener hears about it.
 */
export class History {
	private past: Command[] = [];
	private future: Command[] = [];
	private listeners = new Set<HistoryListener>();
	private open: { label: string; parts: Command[] } | null = null;
	/** Set while a drag is live so consecutive commands fold together. */
	private coalescing = false;

	constructor(public doc: Doc) {}

	get canUndo(): boolean {
		return this.past.length > 0;
	}

	get canRedo(): boolean {
		return this.future.length > 0;
	}

	get undoLabel(): string | null {
		return this.past.at(-1)?.label ?? null;
	}

	get redoLabel(): string | null {
		return this.future.at(-1)?.label ?? null;
	}

	subscribe(fn: HistoryListener): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private emit(patch: Patch): void {
		this.doc.meta.modified = new Date().toISOString();
		for (const fn of this.listeners) fn(patch);
	}

	/** Run a command, add it to the stack, tell everyone what moved. */
	run(cmd: Command): Patch {
		const patch = cmd.apply(this.doc);
		if (this.open) {
			this.open.parts.push(cmd);
		} else {
			const prev = this.past.at(-1);
			const folded = this.coalescing && prev?.coalesce ? prev.coalesce(cmd) : null;
			if (folded) this.past[this.past.length - 1] = folded;
			else this.past.push(cmd);
			if (this.past.length > LIMIT) this.past.shift();
			this.future = [];
		}
		this.emit(patch);
		return patch;
	}

	/**
	 * Everything run inside the callback undoes as one step. Nested calls join
	 * the outer transaction rather than opening a second one.
	 */
	transact<T>(label: string, fn: () => T): T {
		if (this.open) return fn();
		const open = { label, parts: [] as Command[] };
		this.open = open;
		try {
			const out = fn();
			const parts = open.parts;
			this.open = null;
			if (parts.length === 1) this.past.push(parts[0]);
			else if (parts.length > 1) this.past.push(new Batch(label, parts));
			if (parts.length > 0) {
				if (this.past.length > LIMIT) this.past.shift();
				this.future = [];
			}
			return out;
		} catch (err) {
			const parts = open.parts;
			this.open = null;
			for (let i = parts.length - 1; i >= 0; i--) parts[i].invert(this.doc);
			this.emit(PATCH_ALL);
			throw err;
		}
	}

	/** Fold commands run inside the callback into the previous stack entry. */
	coalesced<T>(fn: () => T): T {
		const was = this.coalescing;
		this.coalescing = true;
		try {
			return fn();
		} finally {
			this.coalescing = was;
		}
	}

	/** Call when a drag ends, so the next edit starts a fresh undo step. */
	endCoalescing(): void {
		this.coalescing = false;
	}

	undo(): Patch | null {
		const cmd = this.past.pop();
		if (!cmd) return null;
		const patch = cmd.invert(this.doc);
		this.future.push(cmd);
		this.emit(patch);
		return patch;
	}

	redo(): Patch | null {
		const cmd = this.future.pop();
		if (!cmd) return null;
		const patch = cmd.apply(this.doc);
		this.past.push(cmd);
		this.emit(patch);
		return patch;
	}

	/** Swap in a loaded document; history does not survive the swap. */
	reset(doc: Doc): void {
		this.doc = doc;
		this.past = [];
		this.future = [];
		this.open = null;
		this.coalescing = false;
		for (const fn of this.listeners) fn(PATCH_ALL);
	}

	/** Report a change made outside the stack, such as an asset landing. */
	notify(patch: Patch): void {
		this.emit(patch);
	}

	static merge = mergePatch;
}
