import { describe, expect, it } from 'vitest'
import { assembleZ80 } from '../asm'
import { FLAG_C, FLAG_H, FLAG_N, FLAG_PV, FLAG_S, FLAG_Z, Z80Cpu } from '../cpu'

const C = FLAG_C, N = FLAG_N, PV = FLAG_PV, H = FLAG_H, Z = FLAG_Z, S = FLAG_S
const XY = 0x28

/** The bytes of one instruction. */
function encode(line: string): number[] {
	const { image, diagnostics } = assembleZ80({ name: 'test.z80', code: `\t${line}\n` })
	expect(diagnostics, line).toEqual([])
	return Array.from(image!.sections[0].bytes)
}

/** A CPU with `bytes` at 0x100 and the PC on them. */
function cpuWith(bytes: number[], setup: (cpu: Z80Cpu) => void = () => {}): Z80Cpu {
	const cpu = new Z80Cpu()
	cpu.reset()
	cpu.loadBytes(0x100, bytes)
	cpu.pc = 0x100
	setup(cpu)
	return cpu
}

/** Runs one line from the state `setup` leaves; returns the CPU and the T-states it took. */
function run(line: string, setup: (cpu: Z80Cpu) => void = () => {}) {
	const cpu = cpuWith(encode(line), setup)
	const states = cpu.step()
	return { cpu, states }
}

/** Runs a whole program from 0 until HALT. */
function program(code: string): Z80Cpu {
	const { image, diagnostics } = assembleZ80({ name: 'test.z80', code })
	expect(diagnostics).toEqual([])
	const cpu = new Z80Cpu()
	cpu.reset()
	for (const section of image!.sections) cpu.loadBytes(section.address, section.bytes)
	for (let step = 0; step < 100_000 && !cpu.halted; step++) cpu.step()
	return cpu
}

const parity = (value: number) => {
	let bits = 0
	for (let bit = 0; bit < 8; bit++) bits += (value >> bit) & 1
	return bits % 2 === 0
}
const signed8 = (value: number) => (value << 24) >> 24

/** Flags as the Z80 manuals define them, worked out separately from the CPU's own formulas. */
function referenceAlu(operation: number, a: number, b: number, carry: number): { result: number, flags: number } {
	let result: number
	let flags = 0
	const c = operation === 1 || operation === 3 ? carry : 0
	switch (operation) {
		case 0:
		case 1: {
			const sum = a + b + c
			result = sum & 0xFF
			if ((a & 15) + (b & 15) + c > 15) flags |= H
			const wide = signed8(a) + signed8(b) + c
			if (wide < -128 || wide > 127) flags |= PV
			if (sum > 255) flags |= C
			break
		}
		case 2:
		case 3:
		case 7: {
			const difference = a - b - c
			result = difference & 0xFF
			if ((a & 15) - (b & 15) - c < 0) flags |= H
			const wide = signed8(a) - signed8(b) - c
			if (wide < -128 || wide > 127) flags |= PV
			if (difference < 0) flags |= C
			flags |= N
			break
		}
		default:
			result = operation === 4 ? a & b : operation === 5 ? a ^ b : a | b
			if (operation === 4) flags |= H
			if (parity(result)) flags |= PV
	}
	if (result & 0x80) flags |= S
	if (result === 0) flags |= Z
	// CP takes bits 3 and 5 from the operand; the rest from the result.
	flags |= (operation === 7 ? b : result) & XY
	return { result: operation === 7 ? a : result, flags }
}

describe('8-bit arithmetic, exhaustively', () => {
	const NAMES = ['ADD A,B', 'ADC A,B', 'SUB B', 'SBC A,B', 'AND B', 'XOR B', 'OR B', 'CP B']
	it.each(NAMES.map((name, operation) => [name, operation] as const))('%s matches the reference for every A, B and carry', (_name, operation) => {
		const cpu = new Z80Cpu()
		cpu.reset()
		const opcode = 0x80 | (operation << 3)
		cpu.memory[0] = opcode
		let mismatches = 0
		for (let a = 0; a < 256; a++) {
			for (let b = 0; b < 256; b++) {
				for (let carry = 0; carry < 2; carry++) {
					cpu.pc = 0
					cpu.a = a
					cpu.b = b
					cpu.f = carry
					cpu.step()
					const expected = referenceAlu(operation, a, b, carry)
					if (cpu.a !== expected.result || cpu.f !== expected.flags) {
						if (mismatches++ < 3) expect({ a, b, carry, result: cpu.a, flags: cpu.f }).toEqual({ a, b, carry, ...expected })
					}
				}
			}
		}
		expect(mismatches).toBe(0)
	})

	it('INC and DEC r match the reference for every value', () => {
		const cpu = new Z80Cpu()
		cpu.reset()
		for (let value = 0; value < 256; value++) {
			for (const carry of [0, C]) {
				cpu.memory[0] = 0x04
				cpu.pc = 0
				cpu.b = value
				cpu.f = carry
				cpu.step()
				const up = (value + 1) & 0xFF
				const upFlags = carry | (up & (S | XY)) | (up === 0 ? Z : 0) | ((value & 15) === 15 ? H : 0) | (value === 0x7F ? PV : 0)
				expect([value, cpu.b, cpu.f]).toEqual([value, up, upFlags])
				cpu.memory[0] = 0x05
				cpu.pc = 0
				cpu.b = value
				cpu.f = carry
				cpu.step()
				const down = (value - 1) & 0xFF
				const downFlags = carry | N | (down & (S | XY)) | (down === 0 ? Z : 0) | ((value & 15) === 0 ? H : 0) | (value === 0x80 ? PV : 0)
				expect([value, cpu.b, cpu.f]).toEqual([value, down, downFlags])
			}
		}
	})
})

/**
 * DAA as "The Undocumented Z80 Documented" (Sean Young) tabulates it: a
 * correction chosen by the nibbles and the C and H flags, and the new C and H
 * from their own tables.
 */
function referenceDaa(a: number, flags: number): { result: number, flags: number } {
	const high = a >> 4
	const low = a & 15
	const carry = (flags & C) !== 0
	const half = (flags & H) !== 0
	const subtract = (flags & N) !== 0
	let diff: number
	if (!carry) {
		if (high <= 9 && low <= 9) diff = half ? 0x06 : 0x00
		else if (high <= 8 && low >= 10) diff = 0x06
		else if (high >= 10 && low <= 9) diff = half ? 0x66 : 0x60
		else diff = 0x66
	} else {
		diff = low <= 9 ? (half ? 0x66 : 0x60) : 0x66
	}
	const newCarry = carry || (high >= 9 && low >= 10) || (high >= 10 && low <= 9)
	const newHalf = subtract ? half && low <= 5 : low >= 10
	const result = (subtract ? a - diff : a + diff) & 0xFF
	const out = (result & (S | XY)) | (result === 0 ? Z : 0) | (parity(result) ? PV : 0) | (subtract ? N : 0) | (newHalf ? H : 0) | (newCarry ? C : 0)
	return { result, flags: out }
}

describe('DAA', () => {
	it('matches the documented table for every A, N, H and C', () => {
		const cpu = new Z80Cpu()
		cpu.reset()
		cpu.memory[0] = 0x27
		for (let a = 0; a < 256; a++) {
			for (const flags of [0, C, H, H | C, N, N | C, N | H, N | H | C]) {
				cpu.pc = 0
				cpu.a = a
				cpu.f = flags
				cpu.step()
				expect({ a, flags, result: cpu.a, out: cpu.f }).toEqual({ a, flags, ...(({ result, flags: out }) => ({ result, out }))(referenceDaa(a, flags)) })
			}
		}
	})

	it('adjusts BCD sums and differences', () => {
		expect(program('\tld a,$15\n\tadd a,$27\n\tdaa\n\thalt\n').a).toBe(0x42)
		expect(program('\tld a,$42\n\tsub $15\n\tdaa\n\thalt\n').a).toBe(0x27)
		const carried = program('\tld a,$99\n\tadd a,1\n\tdaa\n\thalt\n')
		expect(carried.a).toBe(0x00)
		expect(carried.f).toBe(Z | PV | H | C)
	})
})

describe('16-bit arithmetic', () => {
	/** Deterministic samples across the range, edges included. */
	const samples = [0, 1, 0x7F, 0x80, 0xFF, 0x0FFF, 0x1000, 0x7FFF, 0x8000, 0x8001, 0xFFFE, 0xFFFF, 0x1234, 0xA5A5, 0x5A5A]
	for (let seed = 7, index = 0; index < 20; index++) {
		seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
		samples.push(seed & 0xFFFF)
	}

	it('ADC HL and SBC HL set every flag as the manual defines them', () => {
		for (const hl of samples) {
			for (const de of samples) {
				for (const carry of [0, 1]) {
					const add = run('adc hl,de', (cpu) => { cpu.hl = hl; cpu.de = de; cpu.f = carry }).cpu
					const sum = hl + de + carry
					const addResult = sum & 0xFFFF
					const addWide = ((hl << 16) >> 16) + ((de << 16) >> 16) + carry
					const addFlags = ((addResult >> 8) & (S | XY)) | (addResult === 0 ? Z : 0) | ((hl & 0xFFF) + (de & 0xFFF) + carry > 0xFFF ? H : 0)
						| (addWide < -32768 || addWide > 32767 ? PV : 0) | (sum > 0xFFFF ? C : 0)
					expect({ hl, de, carry, result: add.hl, flags: add.f }).toEqual({ hl, de, carry, result: addResult, flags: addFlags })

					const sub = run('sbc hl,de', (cpu) => { cpu.hl = hl; cpu.de = de; cpu.f = carry }).cpu
					const difference = hl - de - carry
					const subResult = difference & 0xFFFF
					const subWide = ((hl << 16) >> 16) - ((de << 16) >> 16) - carry
					const subFlags = ((subResult >> 8) & (S | XY)) | (subResult === 0 ? Z : 0) | ((hl & 0xFFF) - (de & 0xFFF) - carry < 0 ? H : 0)
						| (subWide < -32768 || subWide > 32767 ? PV : 0) | (difference < 0 ? C : 0) | N
					expect({ hl, de, carry, result: sub.hl, flags: sub.f }).toEqual({ hl, de, carry, result: subResult, flags: subFlags })
				}
			}
		}
	})

	it('ADD HL keeps S, Z and P/V', () => {
		const { cpu } = run('add hl,bc', (state) => { state.hl = 0x0FFF; state.bc = 1; state.f = S | Z | PV | C })
		expect(cpu.hl).toBe(0x1000)
		expect(cpu.f).toBe(S | Z | PV | H)
	})

	it('SBC HL,HL with a carry gives FFFF', () => {
		const { cpu } = run('sbc hl,hl', (state) => { state.hl = 0x1234; state.f = C })
		expect(cpu.hl).toBe(0xFFFF)
		expect(cpu.f).toBe(S | XY | H | N | C)
	})
})

describe('shifts, rotates and bits', () => {
	it('CB shifts and rotates every value as defined', () => {
		const reference = [
			(v: number) => [((v << 1) | (v >> 7)) & 0xFF, v >> 7],
			(v: number) => [(v >> 1) | ((v & 1) << 7), v & 1],
			(v: number, c: number) => [((v << 1) | c) & 0xFF, v >> 7],
			(v: number, c: number) => [(v >> 1) | (c << 7), v & 1],
			(v: number) => [(v << 1) & 0xFF, v >> 7],
			(v: number) => [(v >> 1) | (v & 0x80), v & 1],
			(v: number) => [((v << 1) | 1) & 0xFF, v >> 7],
			(v: number) => [v >> 1, v & 1],
		]
		const cpu = new Z80Cpu()
		cpu.reset()
		cpu.memory[0] = 0xCB
		for (let operation = 0; operation < 8; operation++) {
			cpu.memory[1] = (operation << 3) | 0
			for (let value = 0; value < 256; value++) {
				for (const carry of [0, 1]) {
					cpu.pc = 0
					cpu.b = value
					cpu.f = carry
					cpu.step()
					const [result, out] = reference[operation](value, carry)
					const flags = (result & (S | XY)) | (result === 0 ? Z : 0) | (parity(result) ? PV : 0) | out
					expect({ operation, value, carry, result: cpu.b, flags: cpu.f }).toEqual({ operation, value, carry, result, flags })
				}
			}
		}
	})

	it('rotates the accumulator keeping S, Z and P/V', () => {
		const { cpu } = run('rlca', (state) => { state.a = 0x81; state.f = S | Z | PV })
		expect(cpu.a).toBe(0x03)
		expect(cpu.f).toBe(S | Z | PV | C)
		expect(run('rra', (state) => { state.a = 0x01; state.f = C }).cpu.a).toBe(0x80)
	})

	it('BIT sets Z and P/V for a clear bit, S for bit 7, and H always', () => {
		expect(run('bit 7,a', (cpu) => { cpu.a = 0x80; cpu.f = C }).cpu.f).toBe(S | H | C)
		expect(run('bit 0,a', (cpu) => { cpu.a = 0x80; cpu.f = 0 }).cpu.f).toBe(Z | PV | H)
		// (IX+d) takes bits 3 and 5 from the address's high byte.
		expect(run('bit 0,(ix+0)', (cpu) => { cpu.ix = 0x2800; cpu.memory[0x2800] = 1; cpu.f = 0 }).cpu.f).toBe(H | 0x28)
	})

	it('RLD and RRD rotate nibbles between A and (HL)', () => {
		const rld = run('rld', (cpu) => { cpu.a = 0x7A; cpu.hl = 0x5000; cpu.memory[0x5000] = 0x31 }).cpu
		expect([rld.a, rld.memory[0x5000]]).toEqual([0x73, 0x1A])
		const rrd = run('rrd', (cpu) => { cpu.a = 0x84; cpu.hl = 0x5000; cpu.memory[0x5000] = 0x20 }).cpu
		expect([rrd.a, rrd.memory[0x5000]]).toEqual([0x80, 0x42])
	})

	it('NEG negates with the flags of 0 - A', () => {
		const { cpu } = run('neg', (state) => { state.a = 1 })
		expect(cpu.a).toBe(0xFF)
		expect(cpu.f).toBe(S | XY | H | N | C)
		expect(run('neg', (state) => { state.a = 0x80 }).cpu.f & PV).toBe(PV)
	})

	it('SCF, CCF and CPL', () => {
		expect(run('scf', (cpu) => { cpu.a = 0; cpu.f = Z | N | H }).cpu.f).toBe(Z | C)
		expect(run('ccf', (cpu) => { cpu.a = 0; cpu.f = C }).cpu.f).toBe(H)
		const cpl = run('cpl', (cpu) => { cpu.a = 0x0F; cpu.f = 0 }).cpu
		expect([cpl.a, cpl.f]).toEqual([0xF0, H | N | 0x20])
	})
})

describe('block instructions', () => {
	it('LDIR copies and leaves BC zero, taking 21 T-states a byte and 16 for the last', () => {
		const cpu = cpuWith(encode('ldir'), (state) => {
			state.hl = 0x4000
			state.de = 0x5000
			state.bc = 3
			state.loadBytes(0x4000, [1, 2, 3])
		})
		let states = 0
		while (cpu.pc === 0x100) states += cpu.step()
		expect(states).toBe(21 + 21 + 16)
		expect(Array.from(cpu.memory.subarray(0x5000, 0x5003))).toEqual([1, 2, 3])
		expect([cpu.hl, cpu.de, cpu.bc]).toEqual([0x4003, 0x5003, 0])
		expect(cpu.f & PV).toBe(0)
	})

	it('LDDR copies downwards', () => {
		const cpu = program('\tld hl,src+2\n\tld de,dst+2\n\tld bc,3\n\tlddr\n\thalt\nsrc:\tdb 7,8,9\ndst:\tds 3\n')
		expect(Array.from(cpu.memory.subarray(cpu.de + 1, cpu.de + 4))).toEqual([7, 8, 9])
	})

	it('LDI sets P/V while BC is not zero', () => {
		const { cpu } = run('ldi', (state) => { state.hl = 0x4000; state.de = 0x5000; state.bc = 2 })
		expect(cpu.f & PV).toBe(PV)
		expect(cpu.bc).toBe(1)
	})

	it('CPIR stops on a match with Z set and P/V for what is left', () => {
		const cpu = program('\tld hl,text\n\tld bc,5\n\tld a,\'C\'\n\tcpir\n\thalt\ntext:\tdb "ABCDE"\n')
		const text = 0x0B
		expect(cpu.hl).toBe(text + 3)
		expect(cpu.bc).toBe(2)
		expect(cpu.f & (Z | PV | N)).toBe(Z | PV | N)
	})

	it('CPIR runs out with Z clear', () => {
		const cpu = program('\tld hl,text\n\tld bc,3\n\tld a,\'Z\'\n\tcpir\n\thalt\ntext:\tdb "ABC"\n')
		expect(cpu.bc).toBe(0)
		expect(cpu.f & (Z | PV)).toBe(0)
	})

	it('OTIR and INIR move bytes through ports', () => {
		const written: [number, number][] = []
		const cpu = cpuWith(encode('otir'), (state) => {
			state.hl = 0x4000
			state.bc = 0x0310
			state.loadBytes(0x4000, [0x41, 0x42, 0x43])
			state.bus = { readDevice: () => undefined, writeDevice: () => false, input: () => 0, output: (port, value) => { written.push([port, value]) } }
		})
		while (cpu.pc === 0x100) cpu.step()
		// B is decremented before the port address goes out.
		expect(written).toEqual([[0x0210, 0x41], [0x0110, 0x42], [0x0010, 0x43]])
		expect(cpu.f & Z).toBe(Z)

		let next = 0x61
		const reader = cpuWith(encode('inir'), (state) => {
			state.hl = 0x4000
			state.bc = 0x0220
			state.bus = { readDevice: () => undefined, writeDevice: () => false, input: () => next++, output: () => {} }
		})
		while (reader.pc === 0x100) reader.step()
		expect(Array.from(reader.memory.subarray(0x4000, 0x4002))).toEqual([0x61, 0x62])
		expect(reader.b).toBe(0)
	})
})

describe('registers', () => {
	it('swaps the alternate set with EX AF,AF\' and EXX', () => {
		const cpu = program('\tld a,1\n\tld bc,$0203\n\tex af,af\'\n\texx\n\tld a,9\n\tld bc,$0909\n\tex af,af\'\n\texx\n\thalt\n')
		expect(cpu.a).toBe(1)
		expect(cpu.bc).toBe(0x0203)
		expect(cpu.af2 >> 8).toBe(9)
		expect(cpu.bc2).toBe(0x0909)
	})

	it('uses the index halves and copies DDCB results to a register', () => {
		const cpu = program('\tld ix,$4000\n\tld ixh,$12\n\tld a,ixh\n\tld (ix+1),$81\n\trlc (ix+1),b\n\thalt\n')
		expect(cpu.a).toBe(0x12)
		expect(cpu.ix).toBe(0x1200)
		expect(cpu.memory[0x1201]).toBe(0x03)
		expect(cpu.b).toBe(0x03)
		expect(cpu.f & C).toBe(C)
	})

	it('reads H and L, not the halves, beside (IX+d)', () => {
		const cpu = program('\tld ix,$4000\n\tld hl,$5566\n\tld (ix+2),h\n\tld l,(ix+2)\n\thalt\n')
		expect(cpu.memory[0x4002]).toBe(0x55)
		expect(cpu.l).toBe(0x55)
		expect(cpu.ix).toBe(0x4000)
	})

	it('counts R per opcode fetch, two for a prefixed instruction, keeping bit 7', () => {
		const cpu = cpuWith([0x00, 0xDD, 0x23, 0xCB, 0x00, 0xED, 0x44, 0xDD, 0xCB, 0x00, 0x06], (state) => { state.r = 0xFE })
		cpu.step()
		expect(cpu.r).toBe(0xFF)
		cpu.step()
		expect(cpu.r).toBe(0x81)
		cpu.step()
		cpu.step()
		// DDCB's opcode after the displacement is no M1.
		cpu.step()
		expect(cpu.r).toBe(0x87)
	})

	it('copies IFF2 to P/V with LD A,I and LD A,R', () => {
		expect(run('ld a,i', (cpu) => { cpu.i = 0x80; cpu.iff2 = 1; cpu.f = 0 }).cpu.f).toBe(S | PV)
		// R has counted both opcode fetches by the time it is read.
		const { cpu } = run('ld a,r', (state) => { state.r = 0; state.iff2 = 0; state.f = C })
		expect([cpu.a, cpu.f]).toEqual([2, C])
	})

	it('takes the I/O port high byte from A or B', () => {
		const ports: number[] = []
		const bus = { readDevice: () => undefined, writeDevice: () => false, input: (port: number) => { ports.push(port); return 0x80 }, output: (port: number) => { ports.push(port) } }
		const cpu = cpuWith([...encode('in a,($10)'), ...encode('in c,(c)'), ...encode('out ($20),a')], (state) => { state.a = 0x12; state.bc = 0x3456; state.f = 0; state.bus = bus })
		cpu.step()
		expect(cpu.a).toBe(0x80)
		cpu.step()
		expect(cpu.c).toBe(0x80)
		expect(cpu.f).toBe(S)
		cpu.step()
		expect(ports).toEqual([0x1210, 0x3456, 0x8020])
	})
})

describe('T-states, from the Zilog manual', () => {
	const TIMINGS: [string, number, ((cpu: Z80Cpu) => void)?][] = [
		['nop', 4], ['ld a,5', 7], ['ld b,c', 4], ['ld a,(hl)', 7], ['ld (hl),$12', 10], ['ld a,(ix+1)', 19], ['ld (iy+1),$12', 19],
		['ld ixh,$12', 11], ['ld a,ixl', 8], ['inc (ix+1)', 23], ['inc ix', 10], ['add ix,bc', 15], ['ld ix,$1234', 14],
		['ld ($4000),ix', 20], ['ld bc,($4000)', 20], ['ld hl,($4000)', 16], ['ld a,($4000)', 13], ['push ix', 15], ['pop ix', 14],
		['ex (sp),ix', 23], ['ex (sp),hl', 19], ['jp (ix)', 8], ['ld sp,ix', 10], ['ld sp,hl', 6],
		['bit 0,(ix+1)', 20], ['set 0,(ix+1)', 23], ['bit 0,(hl)', 12], ['res 0,(hl)', 15], ['rlc b', 8],
		['add a,(ix+1)', 19], ['adc hl,de', 15], ['add hl,de', 11], ['inc bc', 6], ['inc (hl)', 11],
		['jp $1234', 10], ['jr $', 12], ['call $1234', 17], ['ret', 10], ['rst $38', 11],
		['jr nz,$', 7, (cpu) => { cpu.f = Z }], ['jr nz,$', 12, (cpu) => { cpu.f = 0 }],
		['djnz $', 13, (cpu) => { cpu.b = 2 }], ['djnz $', 8, (cpu) => { cpu.b = 1 }],
		['call z,$1234', 10, (cpu) => { cpu.f = 0 }], ['call z,$1234', 17, (cpu) => { cpu.f = Z }],
		['ret z', 5, (cpu) => { cpu.f = 0 }], ['ret z', 11, (cpu) => { cpu.f = Z }],
		['in a,($10)', 11], ['out (c),a', 12], ['rld', 18], ['im 1', 8], ['neg', 8], ['ld a,i', 9], ['reti', 14],
		['ldi', 16], ['halt', 4], ['exx', 4], ['ex af,af\'', 4], ['di', 4], ['daa', 4],
	]
	it.each(TIMINGS)('%s takes %i', (line, expected, setup) => {
		expect(run(line, setup).states).toBe(expected)
	})

	it('adds them up in the cycle count', () => {
		const cpu = program('\tnop\n\tld a,5\n\tld (ix+1),a\n\thalt\n')
		expect(cpu.cycles).toBe(4 + 7 + 19 + 4)
	})
})
