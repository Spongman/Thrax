import { describe, expect, it } from 'vitest'
import { decode, encode } from '../isa'
import type { CpuContext } from '../../../core/configuredCpu'

function cpu(): CpuContext {
	const memory = new Uint8Array(65536), r = new Uint32Array(5)
	return { state: new Uint32Array(), writeState() { throw new Error('Unused internal state') }, r, w: new BigUint64Array(), memory, pc: 0, instructionAddress: 0, read(a, bytes = 1, le = false) { let v = 0; for (let i = 0; i < bytes; i++) v |= memory[a + i & 65535] << ((le ? i : bytes - i - 1) * 8); return v >>> 0 }, write(a, v, bytes = 1, le = false) { for (let i = 0; i < bytes; i++) memory[a + i & 65535] = v >>> ((le ? i : bytes - i - 1) * 8) }, readWide() { return 0n }, writeWide() {}, call(a) { this.pc = a }, ret(a) { this.pc = a }, branch() {}, segmentAddress(s, o) { return (s * 16 + o) & 0xfffff }, readSegment() { throw new Error('Unused by this CPU') }, writeSegment() { throw new Error('Unused by this CPU') }, halt() {}, output() {}, inputInteger() { return -17 } }
}
describe('M6800 native encodings', () => {
	it.each([
		['ldaa', ['#0x42'], [0x86, 0x42]], ['ldab', ['<0x20'], [0xd6, 0x20]], ['ldx', ['#0x1234'], [0xce, 0x12, 0x34]],
		['staa', ['4', 'x'], [0xa7, 4]], ['jsr', ['0x1234'], [0xbd, 0x12, 0x34]], ['rts', [], [0x39]], ['swi', [], [0x3f]],
	] as const)('%s has independent expected bytes', (n, o, expected) => { expect(encode(n, o, { address: 0, value: Number })).toEqual(expected) })
	it('uses big-endian operands and native descending hardware stack', () => { const c = cpu(); c.r[3] = 0xefff; c.memory.set([0xbd, 0x12, 0x34]); c.pc = 3; decode(c.memory, 0).execute(c); expect(c.pc).toBe(0x1234); expect(c.memory[0xefff]).toBe(3); expect(c.memory[0xeffe]).toBe(0); c.memory[0x1234] = 0x39; decode(c.memory, 0x1234).execute(c); expect(c.pc).toBe(3); expect(c.r[3]).toBe(0xefff) })
	it('sets half-carry, signed overflow and carry independently', () => { const c = cpu(); c.r[0] = 0x7f; c.memory.set([0x8b, 1]); decode(c.memory, 0).execute(c); expect(c.r[0]).toBe(128); expect(c.r[4] & 0x2b).toBe(0x2a) })
	it('rejects later-family opcodes and invalid direct unary forms', () => { expect(() => encode('mul', [], { address: 0, value: Number })).toThrow(); expect(() => encode('inc', ['<32'], { address: 0, value: Number })).toThrow(); expect(() => decode(new Uint8Array([0x00]), 0)).toThrow('Illegal') })
	it('wraps a native 16-bit word access at the end of the address space', () => { const c = cpu(); c.memory.set([0xfe, 0xff, 0xff], 0x100); c.memory[0xffff] = 0x12; c.memory[0] = 0x34; decode(c.memory, 0x100).execute(c); expect(c.r[2]).toBe(0x1234) })
	it('keeps the original 6800 CPX high-byte flag behavior', () => { const c = cpu(); c.r[2] = 0; c.r[4] = 1; c.memory.set([0x8c, 0, 1]); decode(c.memory, 0).execute(c); expect(c.r[4] & 15).toBe(1); expect(c.r[2]).toBe(0) })
})
