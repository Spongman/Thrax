/**
 * Where a junction dot is painted.
 *
 * The vertex graph records which wire carries a value next, not whether two
 * wires that cross are joined; the drawing answered that, with a dot at a real
 * junction and a bare crossing everywhere else.  These are those dots, read
 * back out of the images by `scripts/detect-xray-junctions.py` and given in the
 * same coordinates as the vertices.
 *
 * Generated, not written.
 */

import type { XrayDiagram } from './datapaths'

export const XRAY_DOTS: Record<XrayDiagram, [number, number][]> = {
	datapath: [
		[192, 362],
		[317, 378],
		[328, 335],
		[328, 336],
		[328, 358],
		[329, 358],
		[329, 378],
		[329, 399],
		[329, 466],
		[348, 358],
		[497, 75],
		[497, 119],
		[526, 379],
		[535, 400],
		[600, 119],
		[692, 364],
	],
	control: [
		[211, 28],
		[222, 52],
		[231, 76],
		[236, 239],
		[236, 336],
		[236, 448],
		[242, 100],
		[252, 124],
		[262, 145],
		[316, 28],
		[325, 52],
		[336, 76],
		[341, 255],
		[341, 308],
		[341, 360],
		[341, 384],
		[346, 100],
		[357, 124],
		[367, 145],
		[412, 28],
		[422, 52],
		[432, 76],
		[435, 283],
		[435, 403],
		[442, 100],
		[452, 124],
		[461, 145],
		[507, 28],
		[517, 52],
		[527, 76],
		[532, 425],
		[532, 470],
		[537, 100],
		[547, 124],
		[557, 145],
	],
	aluControl: [
		[239, 147],
		[239, 230],
	],
	register: [
		[257, 116],
		[257, 147],
		[257, 180],
		[257, 211],
		[272, 158],
		[272, 188],
		[272, 220],
		[547, 242],
		[570, 210],
		[594, 182],
		[616, 150],
		[616, 151],
		[639, 120],
	],
}
