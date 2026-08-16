import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import type { Doc } from '../core/doc/types.js';
import { formatArea, formatLength } from '../core/doc/dimension.js';
import { exportPlanPng, exportViewPng } from './export-image.js';
import { GROUP_SV, takeoff, type Takeoff } from './takeoff.js';

export type PdfOptions = {
	paper?: 'a4' | 'a3';
	orientation?: 'portrait' | 'landscape';
	includeView?: boolean;
	viewCanvas?: HTMLCanvasElement | null;
};

/** Short and long edge in points, 72 to the inch. */
const PAPER_PT: Record<'a4' | 'a3', [number, number]> = {
	a4: [595.28, 841.89],
	a3: [841.89, 1190.55]
};

const PRINT_DPI = 200;
const MARGIN = 46;
const ROW_H = 15;
const BODY = 9.5;
const INK = rgb(0.23, 0.27, 0.24);
const FAINT = rgb(0.49, 0.54, 0.49);
const RULE = rgb(0.78, 0.8, 0.75);

/** The WinAnsi codepoints outside latin-1, so they survive the filter below. */
const WINANSI_EXTRA =
	'\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178';

/**
 * WinAnsi covers Swedish and botanical Latin, but a stray character outside it
 * would make pdf-lib throw, so it becomes a question mark instead.
 */
function wa(text: string): string {
	let out = '';
	for (const ch of text.replace(/[\u2009\u202f\u2007]/g, ' ')) {
		const c = ch.codePointAt(0) ?? 0;
		const ok = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.includes(ch);
		out += ok ? ch : '?';
	}
	return out;
}

function fit(text: string, font: PDFFont, size: number, max: number): string {
	let s = wa(text);
	if (font.widthOfTextAtSize(s, size) <= max) return s;
	while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > max) s = s.slice(0, -1);
	return `${s}…`;
}

type Column = { head: string; width: number; right?: boolean; mono?: boolean };

type Sheet = {
	page: PDFPage;
	y: number;
	readonly w: number;
	readonly h: number;
};

type Fonts = { text: PDFFont; bold: PDFFont; mono: PDFFont };

function cellText(
	sheet: Sheet,
	text: string,
	x: number,
	width: number,
	font: PDFFont,
	size: number,
	right: boolean,
	colour: RGB
): void {
	const s = fit(text, font, size, width - 6);
	const w = font.widthOfTextAtSize(s, size);
	sheet.page.drawText(s, {
		x: right ? x + width - 6 - w : x,
		y: sheet.y,
		size,
		font,
		color: colour
	});
}

function rule(sheet: Sheet, y: number): void {
	sheet.page.drawLine({
		start: { x: MARGIN, y },
		end: { x: sheet.w - MARGIN, y },
		thickness: 0.6,
		color: RULE
	});
}

function drawTable(
	pdf: PDFDocument,
	sheet: Sheet,
	fonts: Fonts,
	columns: readonly Column[],
	rows: readonly (readonly string[])[]
): Sheet {
	const usable = sheet.w - MARGIN * 2;
	const xs: number[] = [];
	let x = MARGIN;
	for (const c of columns) {
		xs.push(x);
		x += c.width * usable;
	}

	const head = (s: Sheet): Sheet => {
		s.y -= 4;
		columns.forEach((c, i) =>
			cellText(s, c.head, xs[i], c.width * usable, fonts.bold, 8.5, c.right ?? false, FAINT)
		);
		s.y -= 6;
		rule(s, s.y);
		s.y -= ROW_H;
		return s;
	};

	let s = head(sheet);
	for (const row of rows) {
		if (s.y < MARGIN + ROW_H) {
			const page = pdf.addPage([s.w, s.h]);
			s = head({ page, y: s.h - MARGIN, w: s.w, h: s.h });
		}
		columns.forEach((c, i) =>
			cellText(
				s,
				row[i] ?? '',
				xs[i],
				c.width * usable,
				c.mono ? fonts.mono : fonts.text,
				BODY,
				c.right ?? false,
				INK
			)
		);
		s.y -= ROW_H;
	}
	return s;
}

/** Starts a new page when a heading would land too low to carry the rows that follow it. */
function heading(pdf: PDFDocument, sheet: Sheet, fonts: Fonts, text: string, size: number): Sheet {
	const s =
		sheet.y < MARGIN + size + ROW_H * 3
			? { page: pdf.addPage([sheet.w, sheet.h]), y: sheet.h - MARGIN, w: sheet.w, h: sheet.h }
			: sheet;
	s.y -= size;
	s.page.drawText(fit(text, fonts.bold, size, s.w - MARGIN * 2), {
		x: MARGIN,
		y: s.y,
		size,
		font: fonts.bold,
		color: INK
	});
	s.y -= 8;
	return s;
}

/** A species missing from the catalog has no sizes, so a zero reads as a dash rather than "0 mm". */
const metres = (m: number): string => (m > 0 ? formatLength(m) : '-');

function drawSchedules(pdf: PDFDocument, sheet: Sheet, fonts: Fonts, doc: Doc, t: Takeoff): void {
	const top = heading(pdf, sheet, fonts, doc.meta.name, 17);
	top.page.drawText(
		wa(
			`Växtlista och mängder · ${doc.meta.modified.slice(0, 10)} · tomt ${formatArea(t.plotAreaM2)}`
		),
		{ x: MARGIN, y: top.y, size: 9, font: fonts.text, color: FAINT }
	);
	top.y -= 22;

	let s = drawTable(
		pdf,
		heading(pdf, top, fonts, 'Växtlista', 12),
		fonts,
		[
			{ head: 'ART', width: 0.26 },
			{ head: 'LATINSKT NAMN', width: 0.32 },
			{ head: 'ANTAL', width: 0.1, right: true, mono: true },
			{ head: 'HÖJD', width: 0.11, right: true, mono: true },
			{ head: 'BREDD', width: 0.11, right: true, mono: true },
			{ head: 'C/C', width: 0.1, right: true, mono: true }
		],
		t.plants.length > 0
			? t.plants.map((p) => [
					p.sv,
					p.latin,
					String(p.count),
					metres(p.matureH),
					metres(p.matureW),
					metres(p.spacing)
				])
			: [['Inga växter i planen', '', '', '', '', '']]
	);

	s.y -= 18;
	s = drawTable(
		pdf,
		heading(pdf, s, fonts, 'Ytor', 12),
		fonts,
		[
			{ head: 'MATERIAL', width: 0.5 },
			{ head: 'GRUPP', width: 0.25 },
			{ head: 'YTA', width: 0.25, right: true, mono: true }
		],
		[
			...t.materials.map((m) => [m.sv, GROUP_SV[m.group] ?? m.group, formatArea(m.areaM2)]),
			['Summa hårdgjort', '', formatArea(t.totalHardM2)],
			['Summa mjuka ytor', '', formatArea(t.totalSoftM2)]
		]
	);

	if (t.edging.length === 0) return;
	s.y -= 18;
	drawTable(
		pdf,
		heading(pdf, s, fonts, 'Staket, mur och häck', 12),
		fonts,
		[
			{ head: 'TYP', width: 0.7 },
			{ head: 'LÖPMETER', width: 0.3, right: true, mono: true }
		],
		t.edging.map((e) => [e.sv, formatLength(e.lengthM)])
	);
}

/** A plan sheet, a planting list, and optionally a 3D view, as one PDF. */
export async function exportPdf(doc: Doc, o: PdfOptions = {}): Promise<Blob> {
	const [shortSide, longSide] = PAPER_PT[o.paper ?? 'a4'];
	const landscape = (o.orientation ?? 'landscape') === 'landscape';
	const pw = landscape ? longSide : shortSide;
	const ph = landscape ? shortSide : longSide;

	const pdf = await PDFDocument.create();
	pdf.setTitle(doc.meta.name);
	pdf.setCreator('Täppa');
	const fonts: Fonts = {
		text: await pdf.embedFont(StandardFonts.Helvetica),
		bold: await pdf.embedFont(StandardFonts.HelveticaBold),
		mono: await pdf.embedFont(StandardFonts.Courier)
	};

	const plan = await exportPlanPng(doc, {
		widthPx: Math.round((pw / 72) * PRINT_DPI),
		heightPx: Math.round((ph / 72) * PRINT_DPI),
		titleBlock: true,
		legend: true
	});
	const planImage = await pdf.embedPng(await plan.arrayBuffer());
	pdf.addPage([pw, ph]).drawImage(planImage, { x: 0, y: 0, width: pw, height: ph });

	const schedules = pdf.addPage([pw, ph]);
	drawSchedules(pdf, { page: schedules, y: ph - MARGIN, w: pw, h: ph }, fonts, doc, takeoff(doc));

	if (o.includeView && o.viewCanvas) {
		const view = await exportViewPng(o.viewCanvas, 2);
		const viewImage = await pdf.embedPng(await view.arrayBuffer());
		const box = { w: pw - MARGIN * 2, h: ph - MARGIN * 2 };
		const scale = Math.min(box.w / viewImage.width, box.h / viewImage.height);
		pdf.addPage([pw, ph]).drawImage(viewImage, {
			x: (pw - viewImage.width * scale) / 2,
			y: (ph - viewImage.height * scale) / 2,
			width: viewImage.width * scale,
			height: viewImage.height * scale
		});
	}

	return new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' });
}
