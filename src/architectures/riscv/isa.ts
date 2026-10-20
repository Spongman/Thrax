/** RV32IM and RV32IMC share the same integer execution operations. */
import { expandCompressed } from './compressed'
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
}
const R = ['add', 'sll', 'slt', 'sltu', 'xor', 'srl', 'or', 'and']
const M = ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu']
const I = ['addi', 'slli', 'slti', 'sltiu', 'xori', 'srli', 'ori', 'andi']
const B = ['beq', 'bne', '', '', 'blt', 'bge', 'bltu', 'bgeu']
export const MNEMONICS = [
	...new Set([
		...R,
		...M,
		...I,
		...B,
		'sub',
		'sra',
		'srai',
		'lui',
		'auipc',
		'lb',
		'lh',
		'lw',
		'lbu',
		'lhu',
		'sb',
		'sh',
		'sw',
		'jal',
		'jalr',
		'fence',
		'ecall',
		'ebreak',
		'li',
		'la',
		'mv',
		'not',
		'neg',
		'j',
		'call',
		'ret',
		'nop',
		'beqz',
		'bnez'
	])
].filter(Boolean)
export function decode(word: number, compressed = false): Instruction {
	word >>>= 0
	const original = word
	const short = compressed && (word & 3) !== 3
	const expanded = short ? expandCompressed(word & 0xffff) : null
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
		format
	}
}
export function disassemble(word: number, address = 0, compressed = false): string {
	const d = decode(word, compressed),
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
		if (name === 'c.lw' || name === 'c.lwsp') return `${name} ${r(d.rd)}, ${d.imm}(${r(d.rs1)})`
		if (name === 'c.sw' || name === 'c.swsp') return `${name} ${r(d.rs2)}, ${d.imm}(${r(d.rs1)})`
		if (d.format === 'R') return `${name} ${r(d.rd)}, ${r(d.rs2)}`
		return `${name} ${r(d.rd)}, ${d.format === 'U' ? d.imm >> 12 : d.imm}`
	}
	if (['ecall', 'ebreak', 'fence'].includes(d.name)) return d.name
	if (d.format === 'R') return `${d.name} ${r(d.rd)}, ${r(d.rs1)}, ${r(d.rs2)}`
	if (d.format === 'B') return `${d.name} ${r(d.rs1)}, ${r(d.rs2)}, 0x${((address + d.imm) >>> 0).toString(16)}`
	if (d.format === 'J') return `jal ${r(d.rd)}, 0x${((address + d.imm) >>> 0).toString(16)}`
	if (d.format === 'U') return `${d.name} ${r(d.rd)}, 0x${(d.opcodeWord >>> 12).toString(16)}`
	if (d.format === 'S') return `${d.name} ${r(d.rs2)}, ${d.imm}(${r(d.rs1)})`
	if ((d.opcodeWord & 127) === 3 || d.name === 'jalr') return `${d.name} ${r(d.rd)}, ${d.imm}(${r(d.rs1)})`
	return `${d.name} ${r(d.rd)}, ${r(d.rs1)}, ${d.imm}`
}
