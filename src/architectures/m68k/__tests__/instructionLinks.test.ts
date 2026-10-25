import { describe, expect, it } from 'vitest'
import { m68kInstructionHelp } from '../instructionHelp'

describe('68k instruction links', () => {
	it.each([
		['move.l', 'https://68k.hax.com/MOVE'], ['asr', 'https://68k.hax.com/ASR'], ['beq', 'https://68k.hax.com/Bcc'], ['dbra', 'https://68k.hax.com/DBccDBRA'], ['seq', 'https://68k.hax.com/Scc'], ['sub', 'https://68k.hax.com/SUB'],
		['fmove.x', 'https://m680x0.github.io/ref/floating-point-instructions.html#pf177'], ['fbogt', 'https://m680x0.github.io/ref/floating-point-instructions.html#pf145'], ['fdbne', 'https://m680x0.github.io/ref/floating-point-instructions.html#pf150'], ['fsin', 'https://m680x0.github.io/ref/floating-point-instructions.html#pf1a4'], ['ftrapeq', 'https://m680x0.github.io/ref/floating-point-instructions.html#pf1bf'],
	])('%s links to its HTML entry', (mnemonic, url) => {
		const name = mnemonic.toUpperCase()
		expect(m68kInstructionHelp(mnemonic)!.contents[0]).toBe(`**[${name}](${url} "Open ${name} in the manual")**`)
	})
})
