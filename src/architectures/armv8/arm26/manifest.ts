/** What the workbench may know of the 26-bit ARM without loading it. */
export const manifest = {
	id: 'arm26',
	name: 'ARM (26-bit, ARMv2a)',
	panels: [],
	// New files are .asm, read in the dialect the settings choose.
	fileExtensions: ['.asm', '.s', '.S', '.armasm'],
} as const
