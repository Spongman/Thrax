import { describe, expect, it } from 'vitest'
import { disassemble } from '../../core/disassembler'
import { describeToken, type DebugDataTipState } from '../debugDataTips'
import { tipParagraphs } from '../../components/SourcePane'

const state: DebugDataTipState = {
	registers: { $t0: 0x10010000, $t1: -2, $sp: 0x7fffeffc } as unknown as DebugDataTipState['registers'],
	memory: { words: new Map([[0x10010004 >>> 2, 0xdeadbeef]]) },
	fpRegisters: Array.from({ length: 32 }, () => 0),
	labels: new Map([['main', 0x00400000]]),
}

/** Where in `text` the first `token` starts, which is where a pointer would be. */
const at = (text: string, token: string) => text.indexOf(token)

describe('the token a pointer is over', () => {
	it('adds a displacement to its base register', () => {
		const text = 'lw $t2, 4($t0)'
		const described = describeToken(text, at(text, '4($t0)'), state)
		expect(described?.address).toBe(0x10010004)
		expect(described?.register).toBe('$t0')
		expect(tipParagraphs(described?.contents ?? [])[1]).toContain('0xDEADBEEF')
	})

	it('reports a negative register as both signs', () => {
		const text = 'addu $t2, $t1, $zero'
		expect(tipParagraphs(describeToken(text, at(text, '$t1'), state)?.contents ?? []))
			.toEqual(['**$t1**', '`0xFFFFFFFE (-2, unsigned 4294967294)`'])
	})

	it('reads an immediate and a label', () => {
		expect(tipParagraphs(describeToken('addiu $t0, $t0, 16', 16, state)?.contents ?? []))
			.toEqual(['**Immediate**', '`0x00000010 (16, unsigned 16)`'])
		expect(describeToken('j main', at('j main', 'main'), state)?.address).toBe(0x00400000)
	})

	it('says nothing about the padding the gutter aligns with', () => {
		expect(describeToken('nop            ', 12, state)).toBeNull()
	})

	it('reads a mnemonic as the instruction it is', () => {
		const text = 'addu $t2, $t1, $zero'
		expect(tipParagraphs(describeToken(text, at(text, 'addu'), state)?.contents ?? []))
			.toEqual([
				'**addu** basic instruction',
				'Add two registers, wrapping around on overflow.',
				'`addu $t1,$t2,$t3`',
				'Pseudo forms: `addu $t1,$t2,100000`',
			])
	})

	it('keeps a format suffix with its mnemonic', () => {
		const text = 'cvt.w.s $f0, $f1'
		const described = describeToken(text, at(text, 'cvt.w.s'), state)
		expect(text.slice(described?.start, (described?.start ?? 0) + (described?.length ?? 0))).toBe('cvt.w.s')
		expect(described?.contents[1]).toBe('Convert a single to an integer word.')
	})

	it('prefers a label to nothing, and a mnemonic to a label spelled like one', () => {
		const labelled: DebugDataTipState = { ...state, labels: new Map([['sub', 0x00400010]]) }
		expect(describeToken('sub $t1, $t2, $t3', 0, labelled)?.address).toBeUndefined()
		expect(describeToken('j main', at('j main', 'main'), state)?.address).toBe(0x00400000)
	})

	it('answers for the disassembly the gutter draws, not only for the source', () => {
		// The two have to agree: an instruction decoded out of its machine word must
		// report the same register value as the same instruction typed in a file.
		const source = 'addu $t0, $t0, $t1'
		const text = disassemble(0x01094021) ?? ''
		expect(text).toBe(source)
		expect(describeToken(text, at(text, '$t1'), state)?.contents)
			.toEqual(describeToken(source, at(source, '$t1'), state)?.contents)
	})
})
