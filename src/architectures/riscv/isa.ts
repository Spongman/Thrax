/** RV32IM and RV32IMC share the same integer execution operations; F and D add a float file. */
import { expandCompressed } from './compressed'
import { ROUNDING_MODES } from './float'
export const ABI = [
	'zero',
	'ra',
	'sp',
	'gp',
	'tp',
	't0',
	't1',
	't2',
	's0',
	's1',
	'a0',
	'a1',
	'a2',
	'a3',
	'a4',
	'a5',
	'a6',
	'a7',
	's2',
	's3',
	's4',
	's5',
	's6',
	's7',
	's8',
	's9',
	's10',
	's11',
	't3',
	't4',
	't5',
	't6'
]
/** f0-f31 ABI names. */
export const FABI = [
	...Array.from({ length: 8 }, (_, i) => `ft${i}`),
	'fs0',
	'fs1',
	...Array.from({ length: 8 }, (_, i) => `fa${i}`),
	...Array.from({ length: 10 }, (_, i) => `fs${i + 2}`),
	...Array.from({ length: 4 }, (_, i) => `ft${i + 8}`)
]
/** Floating-point CSR numbers. */
export const FLOAT_CSRS: Readonly<Record<string, number>> = { fflags: 1, frm: 2, fcsr: 3 }
export const MEMORY_BYTES = 1024 * 1024
export const TEXT_BASE = 0x1000
export const DATA_BASE = 0x10000
export function register(text: string): number {
	const lower = text.toLowerCase()
	if (lower === 'fp') return 8
	const index = ABI.indexOf(lower)
	if (index >= 0) return index
	if (/^x(?:[0-9]|[12][0-9]|3[01])$/.test(lower)) return Number(lower.slice(1))
	throw new Error(`Unknown register '${text}'`)
}
export function fregister(text: string): number {
	const lower = text.toLowerCase()
	const index = FABI.indexOf(lower)
	if (index >= 0) return index
	if (/^f(?:[0-9]|[12][0-9]|3[01])$/.test(lower)) return Number(lower.slice(1))
	throw new Error(`Unknown floating-point register '${text}'`)
}
export function signed(value: number, bits: number): number {
	return (value << (32 - bits)) >> (32 - bits)
}
export interface Instruction {
	word: number
	opcodeWord: number
	size: 2 | 4
	compressedName?: string
	name: string
	rd: number
	rs1: number
	rs2: number
	imm: number
	format: string
	/** funct3: the rounding mode of a float operation. */
	rm: number
	rs3: number
	/** Float or CSR operation; `fp` marks float operands (1 rd, 2 rs1, 4 rs2), `uses` the operands read or written. */
	float?: { fp: number, uses: number, rounding: boolean }
}
const R = ['add', 'sll', 'slt', 'sltu', 'xor', 'srl', 'or', 'and']
const M = ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu']
const I = ['addi', 'slli', 'slti', 'sltiu', 'xori', 'srli', 'ori', 'andi']
const B = ['beq', 'bne', '', '', 'blt', 'bge', 'bltu', 'bgeu']
export { BASE_MNEMONICS as MNEMONICS } from './catalog'
const ARITHMETIC = ['fadd', 'fsub', 'fmul', 'fdiv']
const FUSED = ['fmadd', 'fmsub', 'fnmsub', 'fnmadd']
/** F, D and the floating-point CSRs; flen 0 has none. */
function decodeFloat(word: number, flen: number): { name: string, format: string, fp: number, uses: number, rounding: boolean } | null {
	if (!flen) return null
	const opcode = word & 127,
		f3 = (word >>> 12) & 7,
		rs2 = (word >>> 20) & 31,
		f5 = word >>> 27,
		fmt = (word >>> 25) & 3
	const width = (wide: boolean) => !wide || flen === 64
	if (opcode === 7 || opcode === 0x27) {
		if ((f3 !== 2 && f3 !== 3) || !width(f3 === 3)) return null
		const load = opcode === 7
		return { name: `f${load ? 'l' : 's'}${f3 === 2 ? 'w' : 'd'}`, format: load ? 'I' : 'S', fp: load ? 1 : 4, uses: load ? 3 : 6, rounding: false }
	}
	if (opcode === 0x73) {
		const csr = word >>> 20
		if (!f3 || f3 === 4 || csr < 1 || csr > 3) return null
		return { name: ['', 'csrrw', 'csrrs', 'csrrc', '', 'csrrwi', 'csrrsi', 'csrrci'][f3], format: 'I', fp: 0, uses: f3 < 4 ? 3 : 1, rounding: false }
	}
	if (fmt > 1 || !width(fmt === 1)) return null
	const suffix = fmt ? 'd' : 's',
		validRm = f3 !== 5 && f3 !== 6
	if (opcode === 0x43 || opcode === 0x47 || opcode === 0x4b || opcode === 0x4f)
		return validRm ? { name: `${FUSED[(opcode >>> 2) & 3]}.${suffix}`, format: 'R4', fp: 15, uses: 15, rounding: true } : null
	if (opcode !== 0x53) return null
	const op = (name: string, fp: number, uses: number, rounding = false) =>
		rounding && !validRm ? null : { name, format: 'R', fp, uses, rounding }
	if (f5 < 4) return op(`${ARITHMETIC[f5]}.${suffix}`, 7, 7, true)
	if (f5 === 0x0b) return rs2 ? null : op(`fsqrt.${suffix}`, 3, 3, true)
	if (f5 === 4) return f3 < 3 ? op(`${['fsgnj', 'fsgnjn', 'fsgnjx'][f3]}.${suffix}`, 7, 7) : null
	if (f5 === 5) return f3 < 2 ? op(`${f3 ? 'fmax' : 'fmin'}.${suffix}`, 7, 7) : null
	if (f5 === 8) {
		if (flen !== 64 || rs2 !== 1 - fmt) return null
		return op(fmt ? 'fcvt.d.s' : 'fcvt.s.d', 3, 3, true)
	}
	if (f5 === 0x14) return f3 < 3 ? op(`${['fle', 'flt', 'feq'][f3]}.${suffix}`, 6, 7) : null
	if (f5 === 0x18) return rs2 < 2 ? op(`fcvt.${rs2 ? 'wu' : 'w'}.${suffix}`, 2, 3, true) : null
	if (f5 === 0x1a) return rs2 < 2 ? op(`fcvt.${suffix}.${rs2 ? 'wu' : 'w'}`, 1, 3, true) : null
	if (f5 === 0x1c && !rs2) {
		if (f3 === 1) return op(`fclass.${suffix}`, 2, 3)
		return f3 === 0 && fmt === 0 ? op('fmv.x.w', 2, 3) : null
	}
	if (f5 === 0x1e && !rs2 && !f3 && !fmt) return op('fmv.w.x', 1, 3)
	return null
}
/** Exact conversions take their rounding mode field but never round; they encode RNE by default. */
export const EXACT_CONVERSIONS = ['fcvt.d.s', 'fcvt.d.w', 'fcvt.d.wu']
export function decode(word: number, compressed = false, flen = 0): Instruction {
	word >>>= 0
	const original = word
	const short = compressed && (word & 3) !== 3
	const expanded = short ? expandCompressed(word & 0xffff, flen) : null
	if (short) word = expanded?.word ?? 0
	const opcode = word & 127,
		rd = (word >>> 7) & 31,
		f3 = (word >>> 12) & 7,
		rs1 = (word >>> 15) & 31,
		rs2 = (word >>> 20) & 31,
		f7 = word >>> 25
	let name = '',
		imm = word >> 20,
		format = 'I'
	if (opcode === 0x33) {
		format = 'R'
		name = f7 === 1 ? M[f3] : f7 === 0 ? R[f3] : f7 === 32 && f3 === 0 ? 'sub' : f7 === 32 && f3 === 5 ? 'sra' : ''
	}
	if (opcode === 0x13) {
		name = I[f3]
		if (f3 === 1 || f3 === 5) {
			imm = rs2
			name = f7 === 0 ? I[f3] : f7 === 32 && f3 === 5 ? 'srai' : ''
		}
	}
	if (opcode === 3) name = ['lb', 'lh', 'lw', '', 'lbu', 'lhu'][f3] ?? ''
	if (opcode === 0x23) {
		name = ['sb', 'sh', 'sw'][f3] ?? ''
		format = 'S'
		imm = signed(((word >>> 7) & 31) | ((word >>> 25) << 5), 12)
	}
	if (opcode === 0x63) {
		name = B[f3]
		format = 'B'
		imm = signed(
			(((word >>> 8) & 15) * 2) | (((word >>> 25) & 63) << 5) | (((word >>> 7) & 1) << 11) | ((word >>> 31) << 12),
			13
		)
	}
	if (opcode === 0x37 || opcode === 0x17) {
		name = opcode === 0x37 ? 'lui' : 'auipc'
		format = 'U'
		imm = word & 0xfffff000
	}
	if (opcode === 0x6f) {
		name = 'jal'
		format = 'J'
		imm = signed(
			(((word >>> 21) & 1023) << 1) |
				(((word >>> 20) & 1) << 11) |
				(((word >>> 12) & 255) << 12) |
				((word >>> 31) << 20),
			21
		)
	}
	if (opcode === 0x67 && f3 === 0) name = 'jalr'
	if (word === 0x73) name = 'ecall'
	if (word === 0x100073) name = 'ebreak'
	if (opcode === 0x0f && f3 === 0) name = 'fence'
	const float = name ? null : decodeFloat(word, flen)
	if (float) {
		name = float.name
		format = float.format
		if (format === 'S') imm = signed(((word >>> 7) & 31) | ((word >>> 25) << 5), 12)
	}
	return {
		word: original,
		opcodeWord: word,
		size: short ? 2 : 4,
		compressedName: expanded?.mnemonic,
		name,
		rd,
		rs1,
		rs2,
		imm,
		format,
		rm: f3,
		rs3: word >>> 27,
		float: float ? { fp: float.fp, uses: float.uses, rounding: float.rounding } : undefined
	}
}
const CSR_NAMES = ['', 'fflags', 'frm', 'fcsr']
function disassembleFloat(d: Instruction): string {
	const { fp, uses } = d.float!,
		names = [d.rd, d.rs1, d.rs2, d.rs3].map((n, i) => `${fp & (1 << i) ? 'f' : 'x'}${n}`)
	if (d.name.startsWith('csr')) return `${d.name} x${d.rd}, ${CSR_NAMES[d.imm & 0xfff]}, ${d.rm > 4 ? d.rs1 : `x${d.rs1}`}`
	if (d.format === 'I') return `${d.name} ${names[0]}, ${d.imm}(x${d.rs1})`
	if (d.format === 'S') return `${d.name} ${names[2]}, ${d.imm}(x${d.rs1})`
	const operands = names.filter((_, i) => uses & (1 << i))
	if (d.float!.rounding && d.rm !== (EXACT_CONVERSIONS.includes(d.name) ? 0 : 7)) operands.push(ROUNDING_MODES[d.rm])
	return `${d.name} ${operands.join(', ')}`
}
export function disassemble(word: number, address = 0, compressed = false, flen = 0): string {
	const d = decode(word, compressed, flen),
		r = (n: number) => `x${n}`
	if (!d.name) return `.word 0x${(word >>> 0).toString(16)}`
	if (d.compressedName) {
		const name = d.compressedName,
			target = `0x${((address + d.imm) >>> 0).toString(16)}`
		if (name === 'c.nop' || name === 'c.ebreak') return name
		if (name === 'c.j' || name === 'c.jal') return `${name} ${target}`
		if (name === 'c.beqz' || name === 'c.bnez') return `${name} ${r(d.rs1)}, ${target}`
		if (name === 'c.jr' || name === 'c.jalr') return `${name} ${r(d.rs1)}`
		if (name === 'c.addi4spn') return `${name} ${r(d.rd)}, sp, ${d.imm}`
		const data = name.startsWith('c.f') ? (n: number) => `f${n}` : r
		if (/^c\.f?l[wd]/.test(name)) return `${name} ${data(d.rd)}, ${d.imm}(${r(d.rs1)})`
		if (/^c\.f?s[wd]/.test(name)) return `${name} ${data(d.rs2)}, ${d.imm}(${r(d.rs1)})`
		if (d.format === 'R') return `${name} ${r(d.rd)}, ${r(d.rs2)}`
		return `${name} ${r(d.rd)}, ${d.format === 'U' ? d.imm >> 12 : d.imm}`
	}
	if (d.float) return disassembleFloat(d)
	if (['ecall', 'ebreak', 'fence'].includes(d.name)) return d.name
	if (d.format === 'R') return `${d.name} ${r(d.rd)}, ${r(d.rs1)}, ${r(d.rs2)}`
	if (d.format === 'B') return `${d.name} ${r(d.rs1)}, ${r(d.rs2)}, 0x${((address + d.imm) >>> 0).toString(16)}`
	if (d.format === 'J') return `jal ${r(d.rd)}, 0x${((address + d.imm) >>> 0).toString(16)}`
	if (d.format === 'U') return `${d.name} ${r(d.rd)}, 0x${(d.opcodeWord >>> 12).toString(16)}`
	if (d.format === 'S') return `${d.name} ${r(d.rs2)}, ${d.imm}(${r(d.rs1)})`
	if ((d.opcodeWord & 127) === 3 || d.name === 'jalr') return `${d.name} ${r(d.rd)}, ${d.imm}(${r(d.rs1)})`
	return `${d.name} ${r(d.rd)}, ${r(d.rs1)}, ${d.imm}`
}
