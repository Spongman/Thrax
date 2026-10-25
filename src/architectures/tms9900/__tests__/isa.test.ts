import { describe, expect, it } from 'vitest'
import type { CpuContext } from '../../../core/configuredCpu'
import { decode, encode, getRegister, instructionSize, setRegister, ST, WP } from '../isa'

function cpu(): CpuContext {
	const memory = new Uint8Array(65536), view = new DataView(memory.buffer)
	const context: CpuContext = {
		state: new Uint32Array(), writeState() { throw new Error('Unused internal state') },
		r: new Uint32Array(18), w: new BigUint64Array(), memory, instructionAddress: 0x1000, pc: 0x1004,
		read(a, n = 2, le = false) { return n === 1 ? view.getUint8(a) : n === 2 ? view.getUint16(a, le) : view.getUint32(a, le) },
		write(a, v, n = 2, le = false) { if (n === 1) view.setUint8(a, v); else if (n === 2) view.setUint16(a, v, le); else view.setUint32(a, v, le) },
		readWide(a, le) { return view.getBigUint64(a, le) }, writeWide(a, v, le) { view.setBigUint64(a, v, le) },
		call(target) { context.pc = target }, ret(target) { context.pc = target }, branch(target, taken) { if (taken) context.pc = target },
		halt() {}, output() {}, inputInteger() { return -17 }, segmentAddress(segment, offset) { return segment * 16 + offset },
		readSegment() { throw new Error('Segmented memory is not used by TMS9900') }, writeSegment() { throw new Error('Segmented memory is not used by TMS9900') },
	}
	context.r[WP] = 0x8000
	return context
}
function instruction(c: CpuContext, name: string, operands: string[], address = 0x1000) {
	c.memory.set(encode(name, operands, { address, value: text => Number(text.replace(/^>/, '0x')) }), address)
	const decoded = decode(c.memory, address)
	c.pc = address + decoded.size
	decoded.execute(c)
	return decoded
}

describe('TMS9900 native instruction encodings', () => {
	it.each([
		['LI', ['R1', '>1234'], [0x02, 0x01, 0x12, 0x34]],
		['MOV', ['R1', 'R2'], [0xc0, 0x81]],
		['MOVB', ['R1', 'R2'], [0xd0, 0x81]],
		['BL', ['@>2000'], [0x06, 0xa0, 0x20, 0x00]],
		['RT', [], [0x04, 0x5b]],
		['MPY', ['R3', 'R2'], [0x38, 0x83]],
		['DIV', ['R3', 'R2'], [0x3c, 0x83]],
		['XOP', ['R1', '2'], [0x2c, 0x81]],
		['LWPI', ['>8300'], [0x02, 0xe0, 0x83, 0x00]],
		['RTWP', [], [0x03, 0x80]],
		['MOV', ['@>2000', '@>3000'], [0xc8, 0x20, 0x20, 0x00, 0x30, 0x00]],
	] as const)('encodes %s against independent TI words', (name, operands, expected) => {
		expect(encode(name, operands, { address: 0x1000, value: text => Number(text.replace(/^>/, '0x')) })).toEqual(expected)
		expect(instructionSize(name, operands)).toBe(expected.length)
	})
	it('rejects invalid operands and unsupported CRU', () => {
		const c = { address: 0x1000, value: Number }
		expect(() => encode('LI', ['R16', '1'], c)).toThrow(/register/)
		expect(() => encode('MPY', ['R1', 'R15'], c)).toThrow(/pair/)
		expect(() => encode('MOV', ['@16(R0)', 'R1'], c)).toThrow(/R0/)
		expect(() => encode('JMP', ['8192'], c)).toThrow(/Value/)
		expect(() => encode('SBO', ['0'], c)).toThrow(/Unsupported/)
	})
})

describe('TMS9900 workspace and integer execution', () => {
	it('uses real big-endian workspace memory as register storage and MOVB uses its high byte', () => {
		const c = cpu()
		instruction(c, 'LI', ['R1', '>1234'])
		expect([...c.memory.slice(0x8002, 0x8004)]).toEqual([0x12, 0x34])
		c.memory[0x8002] = 0xab
		expect(getRegister(c, 1)).toBe(0xab34)
		setRegister(c, 2, 0x5678)
		instruction(c, 'MOVB', ['R1', 'R2'])
		expect(getRegister(c, 2)).toBe(0xab78)
		instruction(c, 'LWPI', ['>8300'])
		expect(getRegister(c, 1)).toBe(0)
		expect(c.memory[0x8002]).toBe(0xab)
	})
	it('increments byte and word pointers by their native widths and evaluates source before destination', () => {
		const c = cpu()
		setRegister(c, 1, 0x2000); c.memory.set([0x11, 0x22, 0x33, 0x44], 0x2000)
		instruction(c, 'MOVB', ['*R1+', 'R2'])
		expect(getRegister(c, 1)).toBe(0x2001); expect(getRegister(c, 2)).toBe(0x1100)
		instruction(c, 'MOV', ['*R1+', 'R3'])
		expect(getRegister(c, 1)).toBe(0x2003); expect(getRegister(c, 3)).toBe(0x1122)
	})
	it('implements arithmetic carry/overflow, source-first signed compares, parity and counted shifts', () => {
		const c = cpu()
		setRegister(c, 1, 0x7fff)
		instruction(c, 'AI', ['R1', '1'])
		expect(getRegister(c, 1)).toBe(0x8000); expect(c.r[ST] & 0x0800).toBe(0x0800)
		instruction(c, 'CI', ['R1', '0'])
		expect(c.r[ST] & 0xe000).toBe(0x8000)
		instruction(c, 'JLT', ['4104'])
		expect(c.pc).toBe(4104)
		setRegister(c, 1, 0x8100); setRegister(c, 0, 1)
		instruction(c, 'SRA', ['R1', '0'])
		expect(getRegister(c, 1)).toBe(0xc080)
		setRegister(c, 1, 0x0100)
		instruction(c, 'MOVB', ['R1', 'R2'])
		expect(c.r[ST] & 0x0400).toBe(0x0400)
	})
	it('preserves unsigned 32-bit product/dividend pairs and leaves DIV operands unchanged on overflow', () => {
		const c = cpu()
		setRegister(c, 2, 65535); setRegister(c, 3, 65535)
		instruction(c, 'MPY', ['R3', 'R2'])
		expect(getRegister(c, 2)).toBe(0xfffe); expect(getRegister(c, 3)).toBe(1)
		setRegister(c, 4, 0)
		instruction(c, 'DIV', ['R4', 'R2'])
		expect(c.r[ST] & 0x0800).toBe(0x0800); expect(getRegister(c, 2)).toBe(0xfffe)
		setRegister(c, 2, 0); setRegister(c, 3, 13); setRegister(c, 4, 5)
		instruction(c, 'DIV', ['R4', 'R2'])
		expect(getRegister(c, 2)).toBe(2); expect(getRegister(c, 3)).toBe(3)
		expect(c.r[ST] & 0x0800).toBe(0)
	})
	it('links BL through R11 and returns through B *R11', () => {
		const c = cpu()
		expect(instruction(c, 'BL', ['@>2000']).call).toBe(true)
		expect(getRegister(c, 11)).toBe(0x1004); expect(c.pc).toBe(0x2000)
		instruction(c, 'RT', [])
		expect(c.pc).toBe(0x1004)
	})
	it('switches workspace and saves/restores actual native BLWP context', () => {
		const c = cpu()
		c.write(0x2000, 0x8300, 2, false); c.write(0x2002, 0x3000, 2, false); c.r[ST] = 0xa005
		instruction(c, 'BLWP', ['@>2000'])
		expect(c.r[WP]).toBe(0x8300); expect(c.pc).toBe(0x3000)
		expect([13, 14, 15].map(i => getRegister(c, i))).toEqual([0x8000, 0x1004, 0xa005])
		instruction(c, 'RTWP', [])
		expect(c.r[WP]).toBe(0x8000); expect(c.pc).toBe(0x1004); expect(c.r[ST]).toBe(0xa005)
	})
	it('executes native XOP vectors and passes the effective source address to the new R11', () => {
		const c = cpu()
		c.write(0x48, 0x8300, 2, false); c.write(0x4a, 0x3000, 2, false); c.r[ST] = 0x8004
		instruction(c, 'XOP', ['R1', '2'])
		expect(c.r[WP]).toBe(0x8300); expect(c.pc).toBe(0x3000)
		expect(getRegister(c, 11)).toBe(0x8002)
		expect([13, 14, 15].map(i => getRegister(c, i))).toEqual([0x8000, 0x1002, 0x8004])
		expect(c.r[ST]).toBe(0x8204)
		instruction(c, 'RTWP', [])
		expect(c.r[ST]).toBe(0x8004)
	})
})
