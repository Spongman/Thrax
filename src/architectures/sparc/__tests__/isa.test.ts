import { describe, expect, it } from 'vitest'
import { decode, encode } from '../isa'

// Expected words follow the V8 manual's instruction formats, independently of decode.
describe('SPARC V8 native encodings', () => {
	it.each([
		['nop', [], 0x01000000],
		['sethi', ['0x12345', '%l0'], 0x21012345],
		['add', ['%g1', '5', '%o0'], 0x90006005],
		['save', ['%sp', '-96', '%sp'], 0x9de3bfa0],
		['restore', [], 0x81e80000],
		['ret', [], 0x81c7e008],
		['retl', [], 0x81c3e008],
		['ta', ['0x10'], 0x91d02010],
		['call', ['4104'], 0x40000002],
		['call', ['4092'], 0x7fffffff],
		['be,a', ['4104'], 0x22800002],
		['ld', ['[%sp+4]', '%l0'], 0xe003a004],
		['st', ['%o0', '[%sp+4]'], 0xd023a004],
		['stbar', [], 0x8143c000],
		['btst', ['1', '%l0'], 0x808c2001],
	] as const)('encodes %s against an independent native word', (name, operands, word) => {
		const bytes = encode(name, operands, { address: 0x1000, value: Number })
		expect(bytes).toEqual([word >>> 24, word >>> 16 & 255, word >>> 8 & 255, word & 255])
	})
	it('rejects invalid registers, immediates, pairs, branch alignment and unsupported instructions', () => {
		const c = { address: 0x1000, value: Number }
		expect(() => encode('add', ['%g8', '1', '%g1'], c)).toThrow(/register/)
		expect(() => encode('add', ['%g0', '4096', '%g1'], c)).toThrow(/immediate/)
		expect(() => encode('sll', ['%g1', '32', '%g1'], c)).toThrow(/Shift immediate/)
		expect(() => encode('ldd', ['[%sp]', '%l1'], c)).toThrow(/even register/)
		expect(() => encode('ba', ['4097'], c)).toThrow(/aligned/)
		expect(() => encode('ba', ['8392704'], c)).toThrow(/displacement/)
		expect(() => encode('ta', ['128'], c)).toThrow(/Trap immediate/)
		expect(() => encode('rd', ['%psr', '%g1'], c)).toThrow(/unprivileged/)
		expect(encode('fadds', ['%f0', '%f1', '%f2'], c)).toEqual([0x85, 0xa0, 0x08, 0x21])
		expect(() => encode('fmovd', ['%f0', '%f2'], c)).toThrow(/Unsupported/)
	})
	it.each([0x00000000, 0x81c82000, 0x91d02080, 0x81880000, 0x83286020])('rejects unsupported/reserved word %i', word => {
		const memory = new Uint8Array([word >>> 24, word >>> 16 & 255, word >>> 8 & 255, word & 255])
		expect(() => decode(memory, 0)).toThrow()
	})
})
