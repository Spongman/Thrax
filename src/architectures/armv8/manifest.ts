/** What the workbench may know of ARM without loading it; retain the persisted id. */
export const manifest = {
	id: 'armv8',
	defaultVariant: 'AArch64 (A64)',
	name: 'ARM',
	maker: 'Arm',
	panels: [],
	// New files are .s; .armasm files are AArch32 armasm.
	fileExtensions: ['.s', '.S', '.armasm'],
} as const
