/**
 * What the workbench may know of MIPS without loading it: its name, and the
 * ids of the panels it contributes, so a saved layout holding one stays valid
 * while another target is active.
 */
export const manifest = {
	id: 'mips',
	defaultVariant: 'MIPS32 (MARS)',
	name: 'MIPS (MARS)',
	maker: 'MIPS Technologies',
	panels: ['xray', 'marsBot', 'scavengerHunt', 'digitalLab'],
} as const
