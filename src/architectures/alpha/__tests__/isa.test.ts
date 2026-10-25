import { describe, expect, it } from 'vitest'
import type { CpuContext } from '../../../core/configuredCpu'
import { decode, encode } from '../isa'

function cpu(): CpuContext {
	const memory = new Uint8Array(0x10000), view = new DataView(memory.buffer)
	const context: CpuContext = {
		state: new Uint32Array(), writeState() { throw new Error('Unused internal state') },
		r: new Uint32Array(), w: new BigUint64Array(65), memory, instructionAddress: 0x1000, pc: 0x1004,
		read(a, n = 4, le = true) { return n === 1 ? view.getUint8(a) : n === 2 ? view.getUint16(a, le) : view.getUint32(a, le) },
		write(a, v, n = 4, le = true) { if (n === 1) view.setUint8(a, v); else if (n === 2) view.setUint16(a, v, le); else view.setUint32(a, v, le) },
		readWide(a, le) { return view.getBigUint64(a, le) }, writeWide(a, v, le) { view.setBigUint64(a, v, le) },
		call(target) { context.pc = target }, ret(target) { context.pc = target }, halt() {}, output() {}, inputInteger() { return -17 },
		branch(target, taken) { if (taken) context.pc = target }, segmentAddress(segment, offset) { return segment * 16 + offset },
		readSegment() { throw new Error('Segmented memory is not used by Alpha') }, writeSegment() { throw new Error('Segmented memory is not used by Alpha') },
	}
	return context
}
function instruction(c: CpuContext, name: string, operands: string[], address = 0x1000) {
	c.memory.set(encode(name, operands, { address, value: Number }), address)
	const decoded = decode(c.memory, address)
	decoded.execute(c)
	return decoded
}

describe('Alpha native instruction encodings', () => {
	it.each([
		['lda', ['$16', '3($31)'], [0x03, 0x00, 0x1f, 0x22]],
		['addq', ['$1', '5', '$16'], [0x10, 0xb4, 0x20, 0x40]],
		['stq', ['$26', '24($30)'], [0x18, 0x00, 0x5e, 0xb7]],
		['ldq', ['$16', '16($30)'], [0x10, 0x00, 0x1e, 0xa6]],
		['ret', [], [0x01, 0x80, 0xfa, 0x6b]],
		['call_pal', ['0x83'], [0x83, 0x00, 0x00, 0x00]],
		['bsr', ['$26', '4104'], [0x01, 0x00, 0x40, 0xd3]],
	] as const)('encodes %s against independent words', (name, operands, expected) => {
		expect(encode(name, operands, { address: 0x1000, value: Number })).toEqual(expected)
	})
	it('rejects invalid registers, signed literals, unaligned branches and unsupported VAX floating point', () => {
		const context = { address: 0x1000, value: Number }
		expect(() => encode('lda', ['$32', '1'], context)).toThrow(/register/)
		expect(() => encode('addq', ['$1', '-1', '$2'], context)).toThrow(/literal/)
		expect(() => encode('br', ['$31', '4097'], context)).toThrow(/aligned/)
		expect(() => encode('ldf', ['$f0', '0($1)'], context)).toThrow(/Unsupported/)
	})
})

describe('Alpha exact 64-bit native execution', () => {
	it('preserves values above Number precision and discards writes to the zero register', () => {
		const c = cpu()
		c.w[1] = 0x20000000000001n
		instruction(c, 'addq', ['$1', '1', '$2'])
		expect(c.w[2]).toBe(0x20000000000002n)
		instruction(c, 'addq', ['$1', '$2', '$31'])
		expect(c.w[31]).toBe(0n)
		c.w[31] = 123n
		instruction(c, 'bis', ['$31', '0', '$3'])
		expect(c.w[3]).toBe(0n)
	})
	it('wraps quadwords, sign extends longwords, compares signed and unsigned separately', () => {
		const c = cpu()
		c.w[1] = 0xffffffffffffffffn
		instruction(c, 'addq', ['$1', '1', '$2'])
		expect(c.w[2]).toBe(0n)
		c.w[3] = 0x7fffffffn
		instruction(c, 'addl', ['$3', '1', '$4'])
		expect(c.w[4]).toBe(0xffffffff80000000n)
		instruction(c, 'cmplt', ['$1', '1', '$5'])
		expect(c.w[5]).toBe(1n)
		instruction(c, 'cmpult', ['$1', '1', '$5'])
		expect(c.w[5]).toBe(0n)
	})
	it('stores all 64 bits little endian and restores signed LDL values', () => {
		const c = cpu()
		c.w[1] = 0xfedcba9876543210n; c.w[30] = 0x8000n
		instruction(c, 'stq', ['$1', '0($30)'])
		expect([...c.memory.slice(0x8000, 0x8008)]).toEqual([0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0xfe])
		instruction(c, 'ldq', ['$2', '0($30)'])
		expect(c.w[2]).toBe(c.w[1])
		instruction(c, 'ldl', ['$3', '4($30)'])
		expect(c.w[3]).toBe(0xfffffffffedcba98n)
		expect(() => instruction(c, 'ldq', ['$2', '1($30)'])).toThrow(/Unaligned/)
	})
	it('links BSR from the following PC, and RET uses the hardware return register', () => {
		const c = cpu()
		expect(instruction(c, 'bsr', ['$26', '8192']).call).toBe(true)
		expect(c.w[26]).toBe(0x1004n); expect(c.pc).toBe(8192)
		instruction(c, 'ret', [])
		expect(c.pc).toBe(0x1004)
	})
	it('implements literal shifts and traps overflow only for /V forms', () => {
		const c = cpu()
		c.w[1] = 0x7fffffffffffffffn
		expect(() => instruction(c, 'addq/v', ['$1', '1', '$2'])).toThrow(/overflow/)
		instruction(c, 'addq', ['$1', '1', '$2'])
		expect(c.w[2]).toBe(0x8000000000000000n)
		instruction(c, 'sra', ['$2', '63', '$3'])
		expect(c.w[3]).toBe(0xffffffffffffffffn)
		c.w[1] = 0xffffffffn
		instruction(c, 'addl/v', ['$1', '1', '$2'])
		expect(c.w[2]).toBe(0n)
	})
})
