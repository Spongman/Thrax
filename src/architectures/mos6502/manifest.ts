/** What the workbench may know of the 6502 without loading it. */
export const manifest = {
	id: 'mos6502',
	defaultVariant: 'MOS 6502 (NMOS)',
	name: '6502 family',
	maker: 'MOS Technology',
	panels: [],
	fileExtensions: ['.a65', '.s65'],
} as const
