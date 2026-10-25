import { describe, expect, it } from 'vitest'
import { instructionLink } from '../manual'
import { instructionHelp } from '../instructionHelp'
import { opcodes } from '../isa'

const S360 = 'https://bitsavers.org/pdf/ibm/360/princOps/A22-6821-7_360PrincOpsDec67.pdf'
const S370 = 'https://bitsavers.org/pdf/ibm/370/princOps/GA22-7000-4_370_Principles_Of_Operation_Sep75.pdf'

// Page numbers are PDF page indices, checked against the scanned text:
// "Load Multiple" heads PDF page 29 of A22-6821-7, "Edit and Mark" page 69,
// "Branch and Link" page 75; "Compare Logical Long / CLCL" page 126 of GA22-7000-4.
describe('manual links', () => {
	it.each([
		['LM', `${S360}#page=29`],
		['edmk', `${S360}#page=69`],
		['BAL', `${S360}#page=75`],
		['BNE', `${S360}#page=74`],
		['AER', `${S360}#page=48`],
		['CLCL', `${S370}#page=126`],
		['MVCL', `${S370}#page=133`],
		['MXD', `${S370}#page=167`],
	] as const)('links %s', (mnemonic, url) => {
		expect(instructionLink(mnemonic)).toBe(url)
	})

	it('links every machine instruction and no directive', () => {
		for (const name of opcodes.keys()) expect(instructionLink(name), name).toMatch(/^https:\/\/bitsavers\.org\/pdf\/ibm\/3[67]0\/princOps\/.+#page=\d+$/)
		for (const name of ['csect', 'using', 'dc']) {
			expect(instructionHelp[name], name).toBeDefined()
			expect(instructionLink(name), name).toBeUndefined()
		}
	})
})
