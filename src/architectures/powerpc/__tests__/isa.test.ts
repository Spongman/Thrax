import { describe, expect, it } from 'vitest'
import type { CpuContext } from '../../../core/configuredCpu'
import { decode, encode } from '../isa'

function cpu(): CpuContext {
	const memory = new Uint8Array(0x10000), view = new DataView(memory.buffer)
	const context: CpuContext = {
		state: new Uint32Array(), writeState() { throw new Error('Unused internal state') },
		r: new Uint32Array(101), w: new BigUint64Array(), memory, instructionAddress: 0x1000, pc: 0x1004,
		read(a, n = 4, le = false) { return n === 1 ? view.getUint8(a) : n === 2 ? view.getUint16(a, le) : view.getUint32(a, le) },
		write(a, v, n = 4, le = false) { if (n === 1) view.setUint8(a, v); else if (n === 2) view.setUint16(a, v, le); else view.setUint32(a, v, le) },
		readWide(a, le) { return view.getBigUint64(a, le) }, writeWide(a, v, le) { view.setBigUint64(a, v, le) },
		call(target) { context.pc = target }, ret(target) { context.pc = target }, halt() {}, output() {}, inputInteger() { return -17 },
		branch(target, taken) { if (taken) context.pc = target }, segmentAddress(segment, offset) { return segment * 16 + offset },
		readSegment() { throw new Error('Segmented memory is not used by PowerPC') }, writeSegment() { throw new Error('Segmented memory is not used by PowerPC') },
	}
	return context
}
function instruction(c: CpuContext, name: string, operands: string[], address = 0x1000) {
	const bytes = encode(name, operands, { address, value: Number })
	c.memory.set(bytes, address)
	const decoded = decode(c.memory, address)
	decoded.execute(c)
	return decoded
}

describe('PowerPC native instruction encodings', () => {
	it.each([
		['li', ['r3', '3'], [0x38, 0x60, 0x00, 0x03]],
		['add', ['r3', 'r3', 'r4'], [0x7c, 0x63, 0x22, 0x14]],
		['stw', ['r3', '12(r1)'], [0x90, 0x61, 0x00, 0x0c]],
		['mflr', ['r0'], [0x7c, 0x08, 0x02, 0xa6]],
		['mtlr', ['r0'], [0x7c, 0x08, 0x03, 0xa6]],
		['blr', [], [0x4e, 0x80, 0x00, 0x20]],
		['cmpwi', ['r3', '5'], [0x2c, 0x03, 0x00, 0x05]],
		['sc', [], [0x44, 0x00, 0x00, 0x02]],
		['bl', ['4104'], [0x48, 0x00, 0x00, 0x09]],
	] as const)('encodes %s against independent words', (name, operands, expected) => {
		expect(encode(name, operands, { address: 0x1000, value: Number })).toEqual(expected)
	})
	it('rejects invalid registers, overflowing immediates, misaligned branches and unsupported vector instructions', () => {
		const context = { address: 0x1000, value: Number }
		expect(() => encode('li', ['r32', '1'], context)).toThrow(/register/)
		expect(() => encode('li', ['r3', '65535'], context)).toThrow(/Immediate/)
		expect(() => encode('b', ['4097'], context)).toThrow(/aligned/)
		expect(() => encode('lwzu', ['r3', '4(r3)'], context)).toThrow(/update/)
		expect(() => encode('vaddubm', ['v0', 'v1', 'v2'], context)).toThrow(/Unsupported/)
		expect(() => decode(new Uint8Array(4), 0)).toThrow(/Unsupported/)
	})
})

describe('PowerPC native execution', () => {
	it('keeps r0 ordinary except the add-immediate/address zero-base convention', () => {
		const c = cpu()
		c.r[0] = 999
		instruction(c, 'addi', ['r3', 'r0', '-7'])
		expect(c.r[3]).toBe(0xfffffff9)
		instruction(c, 'add', ['r4', 'r0', 'r3'])
		expect(c.r[4]).toBe(992)
	})
	it('uses big-endian memory and native update-address ordering', () => {
		const c = cpu()
		c.r[1] = 0x8000; c.r[3] = 0x12345678
		instruction(c, 'stwu', ['r3', '-16(r1)'])
		expect(c.r[1]).toBe(0x7ff0)
		expect([...c.memory.slice(0x7ff0, 0x7ff4)]).toEqual([0x12, 0x34, 0x56, 0x78])
		instruction(c, 'lhz', ['r4', '0(r1)'])
		expect(c.r[4]).toBe(0x1234)
	})
	it('sets and branches on CR fields, with CTR counted natively', () => {
		const c = cpu()
		c.r[3] = 0xffffffff
		instruction(c, 'cmpwi', ['r3', '0'])
		expect(c.r[32] >>> 28).toBe(8)
		instruction(c, 'blt', ['8192'])
		expect(c.pc).toBe(8192)
		c.r[34] = 2; c.pc = 0x1004
		instruction(c, 'bdnz', ['8192'])
		expect(c.r[34]).toBe(1); expect(c.pc).toBe(8192)
		c.pc = 0x1004
		instruction(c, 'bdnz', ['8192'])
		expect(c.r[34]).toBe(0); expect(c.pc).toBe(0x1004)
	})
	it('uses the real LR and exposes native call metadata', () => {
		const c = cpu()
		expect(instruction(c, 'bl', ['8192']).call).toBe(true)
		expect(c.r[33]).toBe(0x1004); expect(c.pc).toBe(8192)
		instruction(c, 'blr', [])
		expect(c.pc).toBe(0x1004)
	})
	it('truncates signed division, sign extends loads and updates arithmetic shift carry', () => {
		const c = cpu()
		c.r[3] = -257; c.r[4] = 256
		instruction(c, 'divw', ['r5', 'r3', 'r4'])
		expect(c.r[5]).toBe(0xffffffff)
		instruction(c, 'srawi', ['r5', 'r3', '8'])
		expect(c.r[5]).toBe(0xfffffffe); expect(c.r[35] & 0x20000000).toBe(0x20000000)
		c.r[4] = 0
		expect(() => instruction(c, 'divw', ['r5', 'r3', 'r4'])).toThrow(/zero/)
	})
})
