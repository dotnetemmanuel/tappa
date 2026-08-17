import { describe, expect, it } from 'vitest';
import { createDoc } from '../doc/doc.js';
import { makeRoof, makeWall } from '../doc/factory.js';
import type { Doc } from '../doc/types.js';
import { buildRoof } from './roof.js';

function house(floor: number): { doc: Doc; roofId: string } {
	const doc = createDoc();
	doc.nodes['n-a'] = { x: 0, y: 0 };
	doc.nodes['n-b'] = { x: 8, y: 0 };
	doc.nodes['n-c'] = { x: 8, y: 6 };
	doc.nodes['n-d'] = { x: 0, y: 6 };
	const walls = (
		[
			['n-a', 'n-b'],
			['n-b', 'n-c'],
			['n-c', 'n-d'],
			['n-d', 'n-a']
		] as const
	).map(([a, b]) => ({ ...makeWall(a, b, 0.25, 2.5), floor }));
	doc.entities.push(...walls);
	const roof = makeRoof(
		walls.map((w) => w.id),
		'gable',
		27,
		0
	);
	doc.entities.push(roof);
	return { doc, roofId: roof.id };
}

describe('buildRoof', () => {
	it('sits on the wall tops', () => {
		const { doc, roofId } = house(0);
		const roof = doc.entities.find((e) => e.id === roofId);
		const built = roof?.k === 'roof' ? buildRoof(doc, roof) : null;
		expect(built?.eaveHeight).toBeCloseTo(2.5, 6);
	});

	it('follows a house lifted up the slope', () => {
		const { doc, roofId } = house(1.8);
		const roof = doc.entities.find((e) => e.id === roofId);
		const built = roof?.k === 'roof' ? buildRoof(doc, roof) : null;
		expect(built?.eaveHeight).toBeCloseTo(4.3, 6);
	});

	it('follows a house dug in below zero, rather than floating at a default height', () => {
		const { doc, roofId } = house(-3.7);
		const roof = doc.entities.find((e) => e.id === roofId);
		const built = roof?.k === 'roof' ? buildRoof(doc, roof) : null;
		expect(built?.eaveHeight).toBeCloseTo(-1.2, 6);
		expect(built?.ridgeHeight ?? 0).toBeGreaterThan(-1.2);
	});
});
