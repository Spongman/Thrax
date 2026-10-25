import { describe, expect, it } from 'vitest'
import { betaInstructionHelp } from '../instructionHelp'

const HTML = 'https://computationstructures.org/notes/isas/notes.html'
const DOC = 'https://ocw.mit.edu/courses/6-004-computation-structures-spring-2009/c1b18db634e4052b737b87e2021e4b12_MIT6_004s09_lab_beta_doc.pdf'

describe('Beta instruction links', () => {
	it.each([['add', `${HTML}#TARGET_14.8.3`], ['addc', `${HTML}#TARGET_14.8.4`], ['ldr', `${HTML}#TARGET_14.8.6`], ['sub', `${HTML}#TARGET_14.8.3`], ['subc', `${HTML}#TARGET_14.8.4`], ['push', `${DOC}#page=14`], ['pop', `${DOC}#page=15`], ['xnor', `${HTML}#TARGET_14.8.3`]])('%s links to its documented entry', (mnemonic, url) => {
		const name = mnemonic.toUpperCase()
		expect(betaInstructionHelp(mnemonic)!.contents[0]).toBe(`**[${name}](${url} "Open ${name} in the manual")** — (UASM macro)`)
	})

	it('leaves BSim services and undocumented macros unlinked', () => {
		for (const name of ['halt', 'call']) expect(betaInstructionHelp(name)!.contents[0]).toMatch(/^\*\*[A-Z]+\*\* /)
	})
})
