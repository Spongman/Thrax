/** ARMv6-M encodings, following Arm DDI 0419 and DUI 0497A. */
export interface Instruction {
	name: string
	d: number
	n: number
	m: number
	imm: number
	list: number
	size: number
	word: number
	second: number
	format: string
}
export const ALU = [
	'ands',
	'eors',
	'lsls',
	'lsrs',
	'asrs',
	'adcs',
	'sbcs',
	'rors',
	'tst',
	'rsbs',
	'cmp',
	'cmn',
	'orrs',
	'muls',
	'bics',
	'mvns',
]
export const CONDITIONS = ['eq', 'ne', 'cs', 'cc', 'mi', 'pl', 'vs', 'vc', 'hi', 'ls', 'ge', 'lt', 'gt', 'le']
export const MNEMONICS = [
		...ALU,
		...CONDITIONS.map((c) => 'b' + c),
		'movs',
		'mov',
		'adds',
		'subs',
		'add',
		'sub',
		'b',
		'bl',
		'bx',
		'blx',
		'ldr',
		'str',
		'ldrb',
		'strb',
		'ldrh',
		'strh',
		'ldrsb',
		'ldrsh',
		'ldmia',
		'stmia',
		'push',
		'pop',
		'adr',
		'sxtb',
		'sxth',
		'uxtb',
		'uxth',
		'rev',
		'rev16',
		'revsh',
		'mrs',
		'msr',
		'cpsid',
		'cpsie',
		'dmb',
		'dsb',
		'isb',
		'nop',
		'yield',
		'wfe',
		'wfi',
		'sev',
		'svc',
		'bkpt',
		'udf', 'negs', 'ldm', 'stm', 'bhs', 'blo',
	]

export const SPECIAL: Readonly<Record<string, number>> = {
	apsr: 0,
	iapsr: 1,
	eapsr: 2,
	xpsr: 3,
	psr: 3,
	ipsr: 5,
	epsr: 6,
	iepsr: 7,
	msp: 8,
	psp: 9,
	primask: 16,
	control: 20,
}
export { LANGUAGE, TEXT_BASE, DATA_BASE } from './layout'
export function reg(text: string): number {
	const alias = ({ sp: 13, lr: 14, pc: 15, ip: 12 } as Record<string, number>)[text.toLowerCase()]
	if (alias !== undefined) return alias
	if (/^r(?:[0-9]|1[0-5])$/i.test(text)) return Number(text.slice(1))
	throw new Error(`Unknown Thumb register '${text}'`)
}
export const sign = (v: number, bits: number) => (v << (32 - bits)) >> (32 - bits)
const cache = new Map<number, Instruction>()
export function decode(word: number, second = 0): Instruction {
	const key = word + second * 65536
	const hit = cache.get(key)
	if (hit) return hit
	const i: Instruction = {
		name: '',
		d: word & 7,
		n: (word >> 3) & 7,
		m: (word >> 6) & 7,
		imm: 0,
		list: 0,
		size: 2,
		word,
		second,
		format: '',
	}
	if ((word & 0xf800) < 0x1800) {
		i.name = ['lsls', 'lsrs', 'asrs'][word >> 11]
		i.imm = (word >> 6) & 31
		i.format = 'shift'
	} else if ((word & 0xf800) === 0x1800) {
		i.name = word & 0x200 ? 'subs' : 'adds'
		i.format = word & 0x400 ? 'imm3' : 'rrr'
		i.imm = i.m
	} else if ((word & 0xe000) === 0x2000) {
		i.name = ['movs', 'cmp', 'adds', 'subs'][(word >> 11) & 3]
		i.d = (word >> 8) & 7
		i.n = i.d
		i.imm = word & 255
		i.format = 'imm8'
	} else if ((word & 0xfc00) === 0x4000) {
		i.name = ALU[(word >> 6) & 15]
		i.m = i.n
		i.n = i.d
		i.format = 'alu'
	} else if ((word & 0xfc00) === 0x4400) {
		const op = (word >> 8) & 3
		i.d |= (word >> 4) & 8
		i.n = i.d
		i.m = (word >> 3) & 15
		i.name = ['add', 'cmp', 'mov', word & 0x80 ? 'blx' : 'bx'][op]
		i.format = op === 3 ? 'exchange' : 'high'
		if (op === 3 && (word & 7 || i.m === 13 || i.m === 15)) i.name = ''
		if ((op === 0 && i.d === 15 && i.m === 15) || (op === 1 && (i.d === 15 || i.m === 15))) i.name = ''
	} else if ((word & 0xf800) === 0x4800) {
		i.name = 'ldr'
		i.d = (word >> 8) & 7
		i.n = 15
		i.imm = (word & 255) * 4
		i.format = 'literal'
	} else if ((word & 0xf000) === 0x5000) {
		i.name = ['str', 'strh', 'strb', 'ldrsb', 'ldr', 'ldrh', 'ldrb', 'ldrsh'][(word >> 9) & 7]
		i.format = 'memreg'
	} else if ((word & 0xe000) === 0x6000 || (word & 0xf000) === 0x8000) {
		const half = (word & 0xf000) === 0x8000,
			byte = !!(word & 0x1000) && !half
		i.name = (word & 0x800 ? 'ldr' : 'str') + (half ? 'h' : byte ? 'b' : '')
		i.imm = ((word >> 6) & 31) * (half ? 2 : byte ? 1 : 4)
		i.format = 'memimm'
	} else if ((word & 0xf000) === 0x9000) {
		i.name = word & 0x800 ? 'ldr' : 'str'
		i.d = (word >> 8) & 7
		i.n = 13
		i.imm = (word & 255) * 4
		i.format = 'memimm'
	} else if ((word & 0xf000) === 0xa000) {
		i.name = word & 0x800 ? 'add' : 'adr'
		i.d = (word >> 8) & 7
		i.n = word & 0x800 ? 13 : 15
		i.imm = (word & 255) * 4
		i.format = 'address'
	} else if ((word & 0xff00) === 0xb000) {
		i.name = word & 0x80 ? 'sub' : 'add'
		i.d = i.n = 13
		i.imm = (word & 127) * 4
		i.format = 'sp'
	} else if ((word & 0xff00) === 0xb200) {
		i.name = ['sxth', 'sxtb', 'uxth', 'uxtb'][(word >> 6) & 3]
		i.m = i.n
		i.format = 'unary'
	} else if ((word & 0xf600) === 0xb400) {
		i.name = word & 0x800 ? 'pop' : 'push'
		i.list = (word & 255) | (word & 0x100 ? 1 << (i.name === 'pop' ? 15 : 14) : 0)
		i.format = 'list'
		if (!i.list) i.name = ''
	} else if ((word & 0xffe8) === 0xb660) {
		i.name = word & 0x10 ? 'cpsid' : 'cpsie'
		i.format = 'system'
		if (!(word & 2) || word & 5) i.name = ''
	} else if ((word & 0xff00) === 0xba00) {
		i.name = ['rev', 'rev16', '', 'revsh'][(word >> 6) & 3]
		i.m = i.n
		i.format = 'unary'
	} else if ((word & 0xff00) === 0xbe00) {
		i.name = 'bkpt'
		i.imm = word & 255
		i.format = 'trap'
	} else if ((word & 0xff0f) === 0xbf00) {
		i.name = ['nop', 'yield', 'wfe', 'wfi', 'sev'][(word >> 4) & 15] ?? ''
		i.format = 'system'
	} else if ((word & 0xf000) === 0xc000) {
		i.name = word & 0x800 ? 'ldmia' : 'stmia'
		i.n = (word >> 8) & 7
		i.list = word & 255
		i.format = 'multiple'
		if (!i.list) i.name = ''
	} else if ((word & 0xf000) === 0xd000) {
		const c = (word >> 8) & 15
		i.name = c === 15 ? 'svc' : c === 14 ? 'udf' : `b${CONDITIONS[c]}`
		i.imm = c >= 14 ? word & 255 : sign(word & 255, 8) * 2
		i.format = c >= 14 ? 'trap' : 'conditional'
		i.n = c
	} else if ((word & 0xf800) === 0xe000) {
		i.name = 'b'
		i.imm = sign(word & 2047, 11) * 2
		i.format = 'branch'
	} else if ((word & 0xf800) === 0xf000 && (second & 0xd000) === 0xd000) {
		const s = (word >> 10) & 1,
			j1 = (second >> 13) & 1,
			j2 = (second >> 11) & 1
		i.name = 'bl'
		i.size = 4
		i.imm = sign(
			(s << 24) |
				((1 ^ j1 ^ s) << 23) |
				((1 ^ j2 ^ s) << 22) |
				((word & 1023) << 12) |
				((second & 2047) << 1),
			25,
		)
		i.format = 'branch'
	} else if (word === 0xf3ef && (second & 0xf000) === 0x8000) {
		i.name = 'mrs'
		i.d = (second >> 8) & 15
		i.imm = second & 255
		i.size = 4
		i.format = 'special'
	} else if ((word & 0xfff0) === 0xf380 && (second & 0xff00) === 0x8800) {
		i.name = 'msr'
		i.m = word & 15
		i.imm = second & 255
		i.size = 4
		i.format = 'special'
	} else if (word === 0xf3bf && [0x8f4f, 0x8f5f, 0x8f6f].includes(second)) {
		i.name = ({ 0x8f4f: 'dsb', 0x8f5f: 'dmb', 0x8f6f: 'isb' } as Record<number, string>)[second]
		i.size = 4
		i.format = 'system'
	}
	if (!i.name) throw new Error(`Unsupported ARMv6-M instruction 0x${word.toString(16).padStart(4, '0')}`)
	if (cache.size >= 4096) cache.clear()
	cache.set(key, i)
	return i
}
export function disassemble(i: Instruction, pc: number): string {
	const r = (n: number) => (n === 13 ? 'sp' : n === 14 ? 'lr' : n === 15 ? 'pc' : `r${n}`)
	const list = () =>
		`{${Array.from({ length: 16 }, (_, n) => n)
			.filter((n) => i.list & (1 << n))
			.map(r)
			.join(', ')}}`
	if (i.format === 'branch' || i.format === 'conditional')
		return `${i.name} 0x${((pc + 4 + i.imm) >>> 0).toString(16)}`
	if (i.format === 'list') return `${i.name} ${list()}`
	if (i.format === 'multiple') return `${i.name} ${r(i.n)}!, ${list()}`
	if (i.format === 'exchange') return `${i.name} ${r(i.m)}`
	if (i.format === 'trap') return `${i.name} #${i.imm}`
	if (i.format === 'system') return i.name + (i.name.startsWith('cps') ? ' i' : '')
	if (i.format === 'special') {
		const name = Object.keys(SPECIAL).find((k) => SPECIAL[k] === i.imm) ?? String(i.imm)
		return i.name === 'mrs' ? `mrs ${r(i.d)}, ${name}` : `msr ${name}, ${r(i.m)}`
	}
	if (['literal', 'memreg', 'memimm'].includes(i.format))
		return `${i.name} ${r(i.d)}, [${r(i.n)}, ${i.format === 'memreg' ? r(i.m) : '#' + i.imm}]`
	if (i.format === 'rrr' || i.format === 'shift' || i.format === 'imm3' || i.format === 'address')
		return `${i.name} ${r(i.d)}, ${r(i.n)}, ${i.format === 'rrr' ? r(i.m) : '#' + i.imm}`
	if (i.format === 'imm8' || i.format === 'sp') return `${i.name} ${r(i.d)}, #${i.imm}`
	return `${i.name} ${r(i.d)}, ${r(i.m)}`
}
