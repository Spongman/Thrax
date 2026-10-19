/** What the workbench may know of ARMv8-A without loading it. */
export const manifest = {
	id: 'armv8',
	name: 'ARMv8-A',
	panels: [],
	// New files are .s; .armasm files are AArch32 armasm.
	fileExtensions: ['.s', '.S', '.armasm'],
} as const
