import { describe, expect, it } from 'vitest'
import { A, DPTR, IRAM, PSW, SP, XDATA, decode, encode, readDirect, readRn, writeDirect, writeRn } from '../isa'
import type { CpuContext } from '../../../core/configuredCpu'

function cpu(): CpuContext {
	const memory = new Uint8Array(0x30000), r = new Uint32Array(13)
	return { state: new Uint32Array(), writeState() { throw new Error('Unused internal state') }, r, w: new BigUint64Array(), memory, pc: 0, instructionAddress: 0, read(a) { return memory[a] }, write(a, v) { memory[a] = v }, readWide() { return 0n }, writeWide() {}, call(a) { this.pc = a }, ret(a) { this.pc = a }, branch() {}, segmentAddress(s, o) { return (s * 16 + o) & 0xfffff }, readSegment() { throw new Error('Unused by this CPU') }, writeSegment() { throw new Error('Unused by this CPU') }, halt() {}, output() {}, inputInteger() { return -17 } }
}
describe('Intel 8051 documented ISA', () => {
	it.each([
		['mov', ['a', '#0x42'], [0x74, 0x42]], ['mov', ['dptr', '#0x1234'], [0x90, 0x12, 0x34]], ['mov', ['0x30', '0x20'], [0x85, 0x20, 0x30]],
		['lcall', ['0x1234'], [0x12, 0x12, 0x34]], ['mul', ['ab'], [0xa4]], ['movx', ['@dptr', 'a'], [0xf0]], ['movc', ['a', '@a+dptr'], [0x93]],
		['setb', ['0x90.3'], [0xd2, 0x93]], ['add', ['a', 'r7'], [0x2f]], ['subb', ['a', '@r1'], [0x97]],
	] as const)('%s has independent expected bytes', (n, o, expected) => expect(encode(n, o, { address: 0, value: Number })).toEqual(expected))
	it('keeps Harvard code, internal and external data separate', () => { const c = cpu(); c.r[DPTR] = 0x1234; c.r[A] = 0x56; c.memory[0] = 0xf0; decode(c.memory, 0).execute(c); expect(c.memory[XDATA + 0x1234]).toBe(0x56); expect(c.memory[0x1234]).toBe(0); expect(c.memory[IRAM + 0x34]).toBe(0) })
	it('aliases register banks and bit-addressable internal RAM', () => { const c = cpu(); c.r[PSW] = 8; writeRn(c, 3, 99); expect(c.memory[IRAM + 11]).toBe(99); c.r[PSW] = 0; expect(readRn(c, 3)).toBe(0); c.memory.set([0xd2, 3]); decode(c.memory, 0).execute(c); expect(readDirect(c, 0x20)).toBe(8) })
	it('uses low-byte then high-byte ascending stack for calls', () => { const c = cpu(); c.r[SP] = 7; c.memory.set([0x12, 0x12, 0x34]); c.pc = 3; decode(c.memory, 0).execute(c); expect(c.memory[IRAM + 8]).toBe(3); expect(c.memory[IRAM + 9]).toBe(0); c.memory[0x1234] = 0x22; decode(c.memory, 0x1234).execute(c); expect(c.pc).toBe(3); expect(c.r[SP]).toBe(7) })
	it('refreshes parity and computes arithmetic CY/AC/OV', () => { const c = cpu(); writeDirect(c, 0xe0, 0x7f); c.memory.set([0x24, 1]); decode(c.memory, 0).execute(c); expect(c.r[A]).toBe(0x80); expect(c.r[PSW] & 0xc5).toBe(0x45) })
	it('decodes all documented byte opcodes, rejecting only A5', () => { const c = cpu(); for (let op = 0; op < 256; op++) { c.memory[0] = op; if (op === 0xa5) expect(() => decode(c.memory, 0)).toThrow(); else expect(decode(c.memory, 0).size).toBeGreaterThan(0) } })
})
