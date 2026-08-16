const counters = new Map<string, number>();

/**
 * Short readable ids (`area-7`). Uniqueness only has to hold inside one
 * document, and `adoptIds` keeps the counters ahead of anything loaded.
 */
export function nextId(prefix: string): string {
	const n = (counters.get(prefix) ?? 0) + 1;
	counters.set(prefix, n);
	return `${prefix}-${n}`;
}

export function adoptIds(ids: Iterable<string>): void {
	for (const id of ids) {
		const dash = id.lastIndexOf('-');
		if (dash < 0) continue;
		const prefix = id.slice(0, dash);
		const n = Number(id.slice(dash + 1));
		if (!Number.isFinite(n)) continue;
		if ((counters.get(prefix) ?? 0) < n) counters.set(prefix, n);
	}
}

export function resetIds(): void {
	counters.clear();
}
