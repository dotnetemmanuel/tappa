/** Plan surface colours. The chrome is dark, the drawing sheet is not. */
export const PLAN = {
	paper: '#eceee2',
	gridMinor: '#d3d9c4',
	gridMajor: '#bcc4a9',
	ink: '#3b463c',
	inkFaint: '#7d8a7c',
	plot: '#5a6b58',
	select: '#dfa53c',
	selectSoft: 'rgba(223, 165, 60, 0.18)',
	snap: '#c8631f',
	guide: 'rgba(200, 99, 31, 0.55)',
	dim: '#42504a',
	contour: '#a9b493',
	contourIndex: '#75825c',
	contourText: '#4f5c42',
	slopeTint: '#5d6b45',
	earth: '#d9d2be',
	earthLine: '#6f6a55',
	faceFill: '#dcdccb',
	baseFill: '#c4c5b5',
	roofFill: '#a8a094',
	draft: '#2f473d',
	warn: '#c2543a'
} as const;

export const LINE_PX = {
	hairline: 1,
	thin: 1.25,
	normal: 1.75,
	bold: 2.5
} as const;

/** Handle sizes in CSS pixels, kept constant on screen regardless of zoom. */
export const HANDLE_PX = {
	vertex: 4.5,
	vertexHover: 6.5,
	snap: 7
} as const;
