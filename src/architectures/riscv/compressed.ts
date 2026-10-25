/** RV32C integer and floating-point encodings, from the RISC-V C 2.0 specification. */
export { COMPRESSED_MNEMONICS } from './catalog'

type Field = readonly (readonly [valueBit: number, instructionBit: number])[]
const CI: Field = [
	[0, 2],
	[1, 3],
	[2, 4],
	[3, 5],
	[4, 6],
	[5, 12]
]
const CJ: Field = [
	[1, 3],
	[2, 4],
	[3, 5],
	[4, 11],
	[5, 2],
	[6, 7],
	[7, 6],
	[8, 9],
	[9, 10],
	[10, 8],
	[11, 12]
]
const CB: Field = [
	[1, 3],
	[2, 4],
	[3, 10],
	[4, 11],
	[5, 2],
	[6, 5],
	[7, 6],
	[8, 12]
]
const CL: Field = [
	[2, 6],
	[3, 10],
	[4, 11],
	[5, 12],
	[6, 5]
]
const CIW: Field = [
	[2, 6],
	[3, 5],
	[4, 11],
	[5, 12],
	[6, 7],
	[7, 8],
	[8, 9],
	[9, 10]
]
const SP16: Field = [
	[4, 6],
	[5, 2],
	[6, 5],
	[7, 3],
	[8, 4],
	[9, 12]
]
const LWSP: Field = [
	[2, 4],
	[3, 5],
	[4, 6],
	[5, 12],
	[6, 2],
	[7, 3]
]
const SWSP: Field = [
	[2, 9],
	[3, 10],
	[4, 11],
	[5, 12],
	[6, 7],
	[7, 8]
]
const CLD: Field = [
	[3, 10],
	[4, 11],
	[5, 12],
	[6, 5],
	[7, 6]
]
const LDSP: Field = [
	[3, 5],
	[4, 6],
	[5, 12],
	[6, 2],
	[7, 3],
	[8, 4]
]
const SDSP: Field = [
	[3, 10],
	[4, 11],
	[5, 12],
	[6, 7],
	[7, 8],
	[8, 9]
]
const gather = (word: number, field: Field) => {
	let value = 0
	for (const [v, w] of field) value |= ((word >>> w) & 1) << v
	return value
}
const scatter = (value: number, field: Field) => {
	let word = 0
	for (const [v, w] of field) word |= ((value >>> v) & 1) << w
	return word
}
const sign = (value: number, bits: number) => (value << (32 - bits)) >> (32 - bits)
const iword = (op: number, rd: number, f: number, rs: number, imm: number) =>
	op | (rd << 7) | (f << 12) | (rs << 15) | ((imm & 4095) << 20)
const rword = (rd: number, rs1: number, rs2: number, f = 0, f7 = 0) =>
	0x33 | (rd << 7) | (f << 12) | (rs1 << 15) | (rs2 << 20) | (f7 << 25)
const store = (rs1: number, rs2: number, imm: number, base = 0x2023) =>
	base | ((imm & 31) << 7) | (rs1 << 15) | (rs2 << 20) | (((imm >>> 5) & 127) << 25)
const jump = (rd: number, imm: number) =>
	0x6f |
	(rd << 7) |
	(((imm >>> 12) & 255) << 12) |
	(((imm >>> 11) & 1) << 20) |
	(((imm >>> 1) & 1023) << 21) |
	(((imm >>> 20) & 1) << 31)
const branch = (rs1: number, neq: boolean, imm: number) =>
	0x63 |
	(((imm >>> 11) & 1) << 7) |
	(((imm >>> 1) & 15) << 8) |
	(+neq << 12) |
	(rs1 << 15) |
	(((imm >>> 5) & 63) << 25) |
	(((imm >>> 12) & 1) << 31)

export interface ExpandedCompressed {
	word: number
	mnemonic: string
}

/** Reserved/custom encodings, and float forms beyond flen, return null; HINTs execute harmlessly. */
export function expandCompressed(word: number, flen = 0): ExpandedCompressed | null {
	const quadrant = word & 3,
		f = word >>> 13,
		rd = (word >>> 7) & 31
	const rs2 = (word >>> 2) & 31,
		rp = 8 + ((word >>> 7) & 7),
		dp = 8 + ((word >>> 2) & 7)
	const imm = sign(gather(word, CI), 6)
	const result = (expanded: number, mnemonic: string) => ({ word: expanded >>> 0, mnemonic })
	if (quadrant === 0) {
		if (f === 0) {
			const offset = gather(word, CIW)
			return offset ? result(iword(0x13, dp, 0, 2, offset), 'c.addi4spn') : null
		}
		if (f === 2) return result(iword(3, dp, 2, rp, gather(word, CL)), 'c.lw')
		if (f === 6) return result(store(rp, dp, gather(word, CL)), 'c.sw')
		if (f === 1 && flen === 64) return result(iword(7, dp, 3, rp, gather(word, CLD)), 'c.fld')
		if (f === 3 && flen) return result(iword(7, dp, 2, rp, gather(word, CL)), 'c.flw')
		if (f === 5 && flen === 64) return result(store(rp, dp, gather(word, CLD), 0x3027), 'c.fsd')
		if (f === 7 && flen) return result(store(rp, dp, gather(word, CL), 0x2027), 'c.fsw')
	}
	if (quadrant === 1) {
		if (f === 0) return result(iword(0x13, rd, 0, rd, imm), word === 1 ? 'c.nop' : 'c.addi')
		if (f === 1 || f === 5) return result(jump(f === 1 ? 1 : 0, sign(gather(word, CJ), 12)), f === 1 ? 'c.jal' : 'c.j')
		if (f === 2) return result(iword(0x13, rd, 0, 0, imm), 'c.li')
		if (f === 3) {
			if (rd === 2) {
				const offset = sign(gather(word, SP16), 10)
				return offset ? result(iword(0x13, 2, 0, 2, offset), 'c.addi16sp') : null
			}
			return imm ? result(0x37 | (rd << 7) | (imm << 12), 'c.lui') : null
		}
		if (f === 4) {
			const mode = (word >>> 10) & 3
			if (mode < 2) {
				if (word & 0x1000) return null
				return result(iword(0x13, rp, 5, rp, rs2 | (mode === 1 ? 1024 : 0)), mode ? 'c.srai' : 'c.srli')
			}
			if (mode === 2) return result(iword(0x13, rp, 7, rp, imm), 'c.andi')
			if (word & 0x1000) return null
			const alu = (word >>> 5) & 3
			return result(rword(rp, rp, dp, [0, 4, 6, 7][alu], alu === 0 ? 32 : 0), ['c.sub', 'c.xor', 'c.or', 'c.and'][alu])
		}
		if (f === 6 || f === 7) return result(branch(rp, f === 7, sign(gather(word, CB), 9)), f === 7 ? 'c.bnez' : 'c.beqz')
	}
	if (quadrant === 2) {
		if (f === 0) return word & 0x1000 ? null : result(iword(0x13, rd, 1, rd, rs2), 'c.slli')
		if (f === 2) return rd ? result(iword(3, rd, 2, 2, gather(word, LWSP)), 'c.lwsp') : null
		if (f === 4) {
			if (!(word & 0x1000)) {
				if (!rs2) return rd ? result(iword(0x67, 0, 0, rd, 0), 'c.jr') : null
				return result(rword(rd, 0, rs2), 'c.mv')
			}
			if (!rs2) return rd ? result(iword(0x67, 1, 0, rd, 0), 'c.jalr') : result(0x100073, 'c.ebreak')
			return result(rword(rd, rd, rs2), 'c.add')
		}
		if (f === 6) return result(store(2, rs2, gather(word, SWSP)), 'c.swsp')
		if (f === 1 && flen === 64) return result(iword(7, rd, 3, 2, gather(word, LDSP)), 'c.fldsp')
		if (f === 3 && flen) return result(iword(7, rd, 2, 2, gather(word, LWSP)), 'c.flwsp')
		if (f === 5 && flen === 64) return result(store(2, rs2, gather(word, SDSP), 0x3027), 'c.fsdsp')
		if (f === 7 && flen) return result(store(2, rs2, gather(word, SWSP), 0x2027), 'c.fswsp')
	}
	return null
}

/** Explicit c.* forms only: ordinary instructions retain their original size. */
export function encodeCompressed(
	name: string,
	args: readonly string[],
	address: number,
	register: (text: string) => number,
	evaluate: (text: string) => number,
	fregister: (text: string) => number = register,
	flen = 0
): number {
	const need = (count: number) => {
		if (args.length !== count) throw new Error(`${name} expects ${count} operands`)
	}
	const reg = (index: number, compact = false, nonzero = false) => {
		const value = register(args[index] ?? '')
		if (compact && (value < 8 || value > 15)) throw new Error(`${name} requires registers x8..x15`)
		if (nonzero && value === 0) throw new Error(`${name} requires a nonzero register`)
		return value
	}
	const value = (index: number, min: number, max: number, multiple = 1, nonzero = false) => {
		const v = evaluate(args[index] ?? '')
		if (!Number.isInteger(v) || v < min || v > max || v % multiple || (nonzero && v === 0))
			throw new Error(
				`${name} immediate must be ${min}..${max}, a multiple of ${multiple}${nonzero ? ' and nonzero' : ''}`
			)
		return v
	}
	const memory = (index: number, stack: boolean) => {
		const m = /^(.*?)\(([^()]+)\)$/.exec(args[index] ?? '')
		if (!m) throw new Error('Expected offset(base)')
		const base = register(m[2]),
			offset = evaluate(m[1] || '0')
		if (stack ? base !== 2 : base < 8 || base > 15)
			throw new Error(stack ? 'Stack load/store requires sp' : 'Base register must be x8..x15')
		if (!Number.isInteger(offset) || offset < 0 || offset > (stack ? 252 : 124) || offset % 4)
			throw new Error('Compressed word offset must be aligned and in range')
		return { base, offset }
	}
	if (name === 'c.nop' || name === 'c.ebreak') {
		need(0)
		return name === 'c.nop' ? 1 : 0x9002
	}
	if (name === 'c.addi4spn') {
		need(3)
		if (reg(1) !== 2) throw new Error('c.addi4spn requires sp as its source')
		return scatter(value(2, 4, 1020, 4), CIW) | ((reg(0, true) - 8) << 2)
	}
	if (name === 'c.lw' || name === 'c.sw' || name === 'c.lwsp' || name === 'c.swsp') {
		need(2)
		const stack = name.endsWith('sp'),
			load = name.startsWith('c.lw'),
			r = reg(0, !stack, load && stack)
		const { base, offset } = memory(1, stack)
		if (!stack) return (load ? 0x4000 : 0xc000) | ((base - 8) << 7) | ((r - 8) << 2) | scatter(offset, CL)
		return (load ? 0x4002 : 0xc002) | (r << (load ? 7 : 2)) | scatter(offset, load ? LWSP : SWSP)
	}
	const float = /^c\.f([ls])([wd])(sp)?$/.exec(name)
	if (float) {
		need(2)
		const [, kind, width, stack] = float,
			double = width === 'd'
		if (flen < (double ? 64 : 32)) throw new Error(`${name} requires the ${double ? 'D' : 'F'} extension`)
		const data = fregister(args[0] ?? ''),
			m = /^(.*?)\(([^()]+)\)$/.exec(args[1] ?? '')
		if (!m) throw new Error('Expected offset(base)')
		const base = register(m[2]),
			offset = evaluate(m[1] || '0'),
			size = double ? 8 : 4,
			limit = stack ? (double ? 504 : 252) : double ? 248 : 124
		if (stack ? base !== 2 : base < 8 || base > 15)
			throw new Error(stack ? 'Stack load/store requires sp' : 'Base register must be x8..x15')
		if (!stack && (data < 8 || data > 15)) throw new Error(`${name} requires registers f8..f15`)
		if (!Number.isInteger(offset) || offset < 0 || offset > limit || offset % size)
			throw new Error('Compressed float offset must be aligned and in range')
		const load = kind === 'l',
			funct = (double ? 0x2000 : 0x6000) | (load ? 0 : 0x8000)
		if (!stack) return funct | ((base - 8) << 7) | ((data - 8) << 2) | scatter(offset, double ? CLD : CL)
		return funct | 2 | (data << (load ? 7 : 2)) | scatter(offset, load ? (double ? LDSP : LWSP) : double ? SDSP : SWSP)
	}
	if (name === 'c.j' || name === 'c.jal' || name === 'c.beqz' || name === 'c.bnez') {
		const conditional = name === 'c.beqz' || name === 'c.bnez'
		need(conditional ? 2 : 1)
		const offset = evaluate(args[conditional ? 1 : 0]) - address
		if (
			!Number.isInteger(offset) ||
			offset % 2 ||
			offset < (conditional ? -256 : -2048) ||
			offset > (conditional ? 254 : 2046)
		)
			throw new Error('Compressed branch/jump offset out of range or odd')
		return conditional
			? (name === 'c.beqz' ? 0xc001 : 0xe001) | ((reg(0, true) - 8) << 7) | scatter(offset, CB)
			: (name === 'c.jal' ? 0x2001 : 0xa001) | scatter(offset, CJ)
	}
	if (name === 'c.jr' || name === 'c.jalr') {
		need(1)
		return (name === 'c.jr' ? 0x8002 : 0x9002) | (reg(0, false, true) << 7)
	}
	if (name === 'c.mv' || name === 'c.add') {
		need(2)
		return (name === 'c.mv' ? 0x8002 : 0x9002) | (reg(0) << 7) | (reg(1, false, true) << 2)
	}
	if (['c.sub', 'c.xor', 'c.or', 'c.and'].includes(name)) {
		need(2)
		return (
			0x8c01 |
			((reg(0, true) - 8) << 7) |
			(['c.sub', 'c.xor', 'c.or', 'c.and'].indexOf(name) << 5) |
			((reg(1, true) - 8) << 2)
		)
	}
	if (name === 'c.addi16sp') {
		need(2)
		if (reg(0) !== 2) throw new Error('c.addi16sp requires sp')
		return 0x6101 | scatter(value(1, -512, 496, 16, true), SP16)
	}
	if (name === 'c.lui') {
		need(2)
		const rd = reg(0),
			supplied = evaluate(args[1]),
			imm = supplied >= 0xfffe0 && supplied <= 0xfffff ? sign(supplied, 20) : supplied
		if (rd === 2 || !Number.isInteger(imm) || imm < -32 || imm > 31 || imm === 0)
			throw new Error('c.lui requires rd != sp and a nonzero signed 6-bit upper immediate')
		return 0x6001 | (rd << 7) | scatter(imm, CI)
	}
	if (['c.addi', 'c.li', 'c.andi', 'c.slli', 'c.srli', 'c.srai'].includes(name)) {
		need(2)
		const compact = ['c.andi', 'c.srli', 'c.srai'].includes(name),
			shift = name.includes('slli') || name.includes('srli') || name.includes('srai')
		const rd = reg(0, compact),
			imm = value(1, shift ? 0 : -32, 31)
		const op = (
			{ 'c.addi': 1, 'c.li': 0x4001, 'c.andi': 0x8801, 'c.slli': 2, 'c.srli': 0x8001, 'c.srai': 0x8401 } as Record<
				string,
				number
			>
		)[name]
		return op | ((compact ? rd - 8 : rd) << 7) | scatter(imm, CI)
	}
	throw new Error(`Unsupported RV32C instruction '${name}'`)
}
