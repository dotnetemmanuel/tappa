import type { PropId } from '../doc/types.js';
import type { PropCat, PropDef, PropParam } from './types.js';

const length = (min: number, max: number, def: number, step = 0.1): PropParam => ({
	key: 'length',
	sv: 'Längd',
	min,
	max,
	step,
	default: def
});

const width = (min: number, max: number, def: number, step = 0.1): PropParam => ({
	key: 'width',
	sv: 'Bredd',
	min,
	max,
	step,
	default: def
});

const height = (min: number, max: number, def: number, sv = 'Höjd', step = 0.1): PropParam => ({
	key: 'height',
	sv,
	min,
	max,
	step,
	default: def
});

const diameter = (min: number, max: number, def: number, step = 0.1): PropParam => ({
	key: 'diameter',
	sv: 'Diameter',
	min,
	max,
	step,
	default: def
});

const param = (
	key: string,
	sv: string,
	min: number,
	max: number,
	def: number,
	step = 1
): PropParam => ({ key, sv, min, max, step, default: def });

export const PROPS: readonly PropDef[] = [
	{
		id: 'bench',
		sv: 'Bänk',
		en: 'Bench',
		cat: 'sitting',
		footprint: { w: 1.6, d: 0.6 },
		planShape: 'rect',
		params: [length(1, 2.4, 1.6)],
		occludes: false
	},
	{
		id: 'picnic-table',
		sv: 'Picknickbord',
		en: 'Picnic table',
		cat: 'sitting',
		footprint: { w: 1.8, d: 1.52 },
		planShape: 'rect',
		params: [length(1.4, 2.4, 1.8)],
		occludes: false
	},
	{
		id: 'patio-set',
		sv: 'Bord med stolar',
		en: 'Table and chairs',
		cat: 'sitting',
		footprint: { w: 2.16, d: 2.16 },
		planShape: 'round',
		params: [param('seats', 'Sittplatser', 2, 8, 4, 2)],
		occludes: false
	},
	{
		id: 'parasol',
		sv: 'Parasoll',
		en: 'Parasol',
		cat: 'sitting',
		footprint: { w: 3, d: 3 },
		planShape: 'round',
		params: [diameter(2, 4, 3)],
		occludes: true
	},
	{
		id: 'sun-lounger',
		sv: 'Solstol',
		en: 'Sun lounger',
		cat: 'sitting',
		footprint: { w: 0.7, d: 1.9 },
		planShape: 'rect',
		params: [],
		occludes: false
	},
	{
		id: 'hammock',
		sv: 'Hängmatta med ställning',
		en: 'Hammock with stand',
		cat: 'sitting',
		footprint: { w: 3.2, d: 1.2 },
		planShape: 'rect',
		params: [length(2.6, 4, 3.2)],
		occludes: false
	},
	{
		id: 'fire-pit',
		sv: 'Eldstad',
		en: 'Fire pit',
		cat: 'sitting',
		footprint: { w: 1, d: 1 },
		planShape: 'round',
		params: [diameter(0.6, 1.6, 1)],
		occludes: false
	},
	{
		id: 'grill',
		sv: 'Utegrill',
		en: 'Barbecue',
		cat: 'sitting',
		footprint: { w: 0.7, d: 0.7 },
		planShape: 'round',
		params: [],
		occludes: false
	},

	{
		id: 'pot-small',
		sv: 'Kruka, liten',
		en: 'Pot, small',
		cat: 'growing',
		footprint: { w: 0.3, d: 0.3 },
		planShape: 'round',
		params: [diameter(0.2, 0.4, 0.3, 0.05)],
		occludes: false
	},
	{
		id: 'pot-medium',
		sv: 'Kruka, mellan',
		en: 'Pot, medium',
		cat: 'growing',
		footprint: { w: 0.45, d: 0.45 },
		planShape: 'round',
		params: [diameter(0.35, 0.6, 0.45, 0.05)],
		occludes: false
	},
	{
		id: 'pot-large',
		sv: 'Kruka, stor',
		en: 'Pot, large',
		cat: 'growing',
		footprint: { w: 0.75, d: 0.75 },
		planShape: 'round',
		params: [diameter(0.6, 1.1, 0.75, 0.05)],
		occludes: false
	},
	{
		id: 'planter-box',
		sv: 'Odlingslåda',
		en: 'Planter box',
		cat: 'growing',
		footprint: { w: 1, d: 0.4 },
		planShape: 'rect',
		params: [length(0.6, 2, 1), height(0.3, 0.9, 0.5)],
		occludes: false
	},
	{
		id: 'pallet-collar',
		sv: 'Pallkrage',
		en: 'Pallet collar bed',
		cat: 'growing',
		footprint: { w: 1.2, d: 0.8 },
		planShape: 'rect',
		params: [param('layers', 'Antal kragar', 1, 4, 2)],
		occludes: false
	},
	{
		id: 'raised-bed',
		sv: 'Upphöjd odlingsbädd',
		en: 'Raised bed',
		cat: 'growing',
		footprint: { w: 2.4, d: 1 },
		planShape: 'rect',
		params: [length(1, 6, 2.4), width(0.6, 1.6, 1), height(0.2, 0.9, 0.4)],
		occludes: false
	},
	{
		id: 'cold-frame',
		sv: 'Drivbänk',
		en: 'Cold frame',
		cat: 'growing',
		footprint: { w: 1.2, d: 0.8 },
		planShape: 'rect',
		params: [length(0.8, 2, 1.2)],
		occludes: false
	},
	{
		id: 'compost-bin',
		sv: 'Kompost',
		en: 'Compost bin',
		cat: 'growing',
		footprint: { w: 0.8, d: 0.8 },
		planShape: 'rect',
		params: [width(0.6, 1.2, 0.8)],
		occludes: false
	},
	{
		id: 'trellis',
		sv: 'Spaljé',
		en: 'Trellis',
		cat: 'growing',
		footprint: { w: 1.2, d: 0.08 },
		planShape: 'rect',
		params: [width(0.6, 3, 1.2), height(1.2, 2.4, 1.8)],
		occludes: true
	},
	{
		id: 'greenhouse',
		sv: 'Växthus',
		en: 'Greenhouse',
		cat: 'growing',
		footprint: { w: 3.6, d: 2.4 },
		planShape: 'rect',
		params: [length(2.4, 8, 3.6), width(1.8, 4, 2.4), height(2, 3.4, 2.4, 'Nockhöjd')],
		occludes: true
	},

	{
		id: 'shed',
		sv: 'Förråd',
		en: 'Garden shed',
		cat: 'structure',
		footprint: { w: 3, d: 2.4 },
		planShape: 'rect',
		params: [length(1.8, 5, 3), width(1.5, 4, 2.4), height(1.8, 2.4, 2.1, 'Väggens höjd')],
		occludes: true
	},
	{
		id: 'pergola',
		sv: 'Pergola',
		en: 'Pergola',
		cat: 'structure',
		footprint: { w: 4, d: 3 },
		planShape: 'rect',
		params: [length(2.4, 8, 4), width(2, 5, 3), height(2.1, 3, 2.4)],
		occludes: true
	},
	{
		id: 'gazebo',
		sv: 'Lusthus',
		en: 'Gazebo',
		cat: 'structure',
		footprint: { w: 3, d: 3 },
		planShape: 'round',
		params: [diameter(2.4, 4.5, 3)],
		occludes: true
	},
	{
		id: 'dog-house',
		sv: 'Hundkoja',
		en: 'Dog house',
		cat: 'structure',
		footprint: { w: 1, d: 0.7 },
		planShape: 'rect',
		params: [],
		occludes: false
	},

	{
		id: 'playhouse',
		sv: 'Lekstuga',
		en: 'Playhouse',
		cat: 'play',
		footprint: { w: 1.6, d: 1.44 },
		planShape: 'rect',
		params: [width(1.2, 2.4, 1.6)],
		occludes: true
	},
	{
		id: 'trampoline',
		sv: 'Studsmatta',
		en: 'Trampoline',
		cat: 'play',
		footprint: { w: 3, d: 3 },
		planShape: 'round',
		params: [diameter(2.4, 4.3, 3)],
		occludes: false
	},
	{
		id: 'sandpit',
		sv: 'Sandlåda',
		en: 'Sandpit',
		cat: 'play',
		footprint: { w: 1.5, d: 1.5 },
		planShape: 'rect',
		params: [width(1, 2.4, 1.5)],
		occludes: false
	},
	{
		id: 'swing-set',
		sv: 'Gungställning',
		en: 'Swing set',
		cat: 'play',
		footprint: { w: 2.74, d: 1.83 },
		planShape: 'rect',
		params: [width(2, 3.6, 2.5), height(2, 2.6, 2.3)],
		occludes: false
	},
	{
		id: 'football-goal',
		sv: 'Fotbollsmål',
		en: 'Football goal',
		cat: 'play',
		footprint: { w: 3.09, d: 0.8 },
		planShape: 'rect',
		params: [width(1.5, 5, 3)],
		occludes: false
	},

	{
		id: 'flagpole',
		sv: 'Flaggstång',
		en: 'Flagpole',
		cat: 'utility',
		footprint: { w: 0.45, d: 0.45 },
		planShape: 'round',
		params: [height(5, 12, 7, 'Höjd', 0.5)],
		occludes: true
	},
	{
		id: 'rotary-dryer',
		sv: 'Torkvinda',
		en: 'Rotary dryer',
		cat: 'utility',
		footprint: { w: 2.6, d: 2.6 },
		planShape: 'round',
		params: [diameter(1.8, 3, 2.6)],
		occludes: false
	},
	{
		id: 'log-pile',
		sv: 'Vedtrave',
		en: 'Log pile',
		cat: 'utility',
		footprint: { w: 2, d: 0.5 },
		planShape: 'rect',
		params: [length(1, 4, 2), height(0.8, 1.8, 1.2)],
		occludes: false
	},
	{
		id: 'bike-rack',
		sv: 'Cykelställ',
		en: 'Bike rack',
		cat: 'utility',
		footprint: { w: 1.6, d: 0.7 },
		planShape: 'rect',
		params: [param('places', 'Platser', 2, 8, 4)],
		occludes: false
	},
	{
		id: 'mailbox',
		sv: 'Brevlåda',
		en: 'Mailbox',
		cat: 'utility',
		footprint: { w: 0.4, d: 0.35 },
		planShape: 'rect',
		params: [],
		occludes: false
	},
	{
		id: 'wheelie-bin',
		sv: 'Soptunna',
		en: 'Wheelie bin',
		cat: 'utility',
		footprint: { w: 0.62, d: 0.75 },
		planShape: 'rect',
		params: [param('count', 'Antal', 1, 3, 1)],
		occludes: false
	},
	{
		id: 'stepping-stones',
		sv: 'Trampstenar',
		en: 'Stepping stones',
		cat: 'utility',
		footprint: { w: 3.7, d: 0.6 },
		planShape: 'rect',
		params: [
			param('count', 'Antal stenar', 3, 15, 6),
			param('size', 'Stenstorlek', 0.3, 0.6, 0.4, 0.05)
		],
		occludes: false
	},
	{
		id: 'lantern',
		sv: 'Lykta',
		en: 'Garden lantern',
		cat: 'utility',
		footprint: { w: 0.3, d: 0.3 },
		planShape: 'round',
		params: [height(0.6, 1.6, 1)],
		occludes: false
	},
	{
		id: 'bollard-light',
		sv: 'Pollarbelysning',
		en: 'Bollard light',
		cat: 'utility',
		footprint: { w: 0.18, d: 0.18 },
		planShape: 'round',
		params: [height(0.4, 1.2, 0.8)],
		occludes: false
	},
	{
		id: 'heat-pump',
		sv: 'Luftvärmepump',
		en: 'Air source heat pump',
		cat: 'utility',
		footprint: { w: 0.9, d: 0.4 },
		planShape: 'rect',
		params: [],
		occludes: false
	},

	{
		id: 'hot-tub',
		sv: 'Badtunna',
		en: 'Hot tub',
		cat: 'water',
		footprint: { w: 2, d: 2 },
		planShape: 'round',
		params: [diameter(1.6, 2.4, 2)],
		occludes: false
	},
	{
		id: 'water-butt',
		sv: 'Regnvattentunna',
		en: 'Water butt',
		cat: 'water',
		footprint: { w: 0.6, d: 0.6 },
		planShape: 'round',
		params: [diameter(0.5, 0.9, 0.6, 0.05)],
		occludes: false
	},
	{
		id: 'bird-bath',
		sv: 'Fågelbad',
		en: 'Bird bath',
		cat: 'water',
		footprint: { w: 0.5, d: 0.5 },
		planShape: 'round',
		params: [],
		occludes: false
	},
	{
		id: 'pool',
		sv: 'Pool',
		en: 'Swimming pool',
		cat: 'water',
		footprint: { w: 6, d: 3 },
		planShape: 'rect',
		params: [length(3, 12, 6, 0.5), width(2, 6, 3, 0.5)],
		occludes: false
	},

	{
		id: 'boulder',
		sv: 'Stenblock',
		en: 'Boulder',
		cat: 'nature',
		footprint: { w: 0.9, d: 0.9 },
		planShape: 'round',
		params: [diameter(0.4, 2, 0.9)],
		occludes: false
	},
	{
		id: 'bird-table',
		sv: 'Fågelbord',
		en: 'Bird table',
		cat: 'nature',
		footprint: { w: 0.5, d: 0.5 },
		planShape: 'rect',
		params: [height(1.2, 1.8, 1.5)],
		occludes: false
	},
	{
		id: 'insect-hotel',
		sv: 'Insektshotell',
		en: 'Insect hotel',
		cat: 'nature',
		footprint: { w: 0.5, d: 0.2 },
		planShape: 'rect',
		params: [],
		occludes: false
	}
];

const BY_ID = new Map<PropId, PropDef>(PROPS.map((d) => [d.id, d]));

export function propDef(id: PropId): PropDef | undefined {
	return BY_ID.get(id);
}

/** An unknown kind still has to draw something, so a project from a newer build stays usable. */
export function propDefOr(id: PropId): PropDef {
	return (
		BY_ID.get(id) ?? {
			id,
			sv: 'Okänt föremål',
			en: 'Unknown object',
			cat: 'utility',
			footprint: { w: 0.6, d: 0.6 },
			planShape: 'rect',
			params: [],
			occludes: false
		}
	);
}

export const PROPS_BY_CAT: ReadonlyMap<PropCat, readonly PropDef[]> = (() => {
	const byCat = new Map<PropCat, PropDef[]>();
	for (const def of PROPS) {
		const list = byCat.get(def.cat);
		if (list) list.push(def);
		else byCat.set(def.cat, [def]);
	}
	return byCat;
})();

const fold = (s: string): string =>
	s
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();

const HAYSTACK = new Map<PropId, string>(PROPS.map((d) => [d.id, fold(`${d.sv} ${d.en} ${d.id}`)]));

export function searchProps(q: string): PropDef[] {
	const terms = fold(q).split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [...PROPS];
	return PROPS.filter((d) => {
		const hay = HAYSTACK.get(d.id) ?? '';
		return terms.every((t) => hay.includes(t));
	});
}
