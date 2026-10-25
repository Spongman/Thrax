/** Classic AVRe subset. All debugger/code symbols are byte addresses. */
export interface Instruction {
	name: string
	d?: number
	r?: number
	k?: number
	size: number
}
export const RR: Readonly<Record<string, number>> = {
	add: 0x0c00,
	adc: 0x1c00,
	sub: 0x1800,
	sbc: 0x0800,
	cp: 0x1400,
	cpc: 0x0400,
	and: 0x2000,
	or: 0x2800,
	eor: 0x2400,
	mov: 0x2c00,
	mul: 0x9c00,
	cpse: 0x1000
}
export const IMM: Readonly<Record<string, number>> = {
	ldi: 0xe000,
	subi: 0x5000,
	sbci: 0x4000,
	cpi: 0x3000,
	andi: 0x7000,
	ori: 0x6000
}
export const SINGLE: Readonly<Record<string, number>> = {
	com: 0x9400,
	neg: 0x9401,
	swap: 0x9402,
	inc: 0x9403,
	asr: 0x9405,
	lsr: 0x9406,
	ror: 0x9407,
	dec: 0x940a,
	push: 0x920f,
	pop: 0x900f
}
export const FIXED: Readonly<Record<string, number>> = {
	nop: 0,
	break: 0x9598,
	ret: 0x9508,
	ijmp: 0x9409,
	icall: 0x9509,
	lpm: 0x95c8
}
export { MNEMONICS, BRANCH } from './catalog'
import { BRANCH } from './catalog'

const signed = (value: number, bits: number) => (value << (32 - bits)) >> (32 - bits)
const fixedEntries = Object.entries(FIXED)
const rrEntries = Object.entries(RR)
const immediateEntries = Object.entries(IMM)
const singleEntries = Object.entries(SINGLE)
const bitEntries = [
	['sbrc', 0xfc00],
	['sbrs', 0xfe00],
	['bst', 0xfa00],
	['bld', 0xf800]
] as const
export function decode(word: number, second = 0): Instruction {
	for (const [name, value] of fixedEntries) if (word === value) return { name, size: 2 }
	const d = (word >> 4) & 31
	const r = (word & 15) | ((word >> 5) & 16)
	for (const [name, value] of rrEntries)
		if ((word & 0xfc00) === value) return { name, d, r, size: 2 }
	for (const [name, value] of immediateEntries)
		if ((word & 0xf000) === value)
			return { name, d: 16 + ((word >> 4) & 15), k: (word & 15) | ((word >> 4) & 0xf0), size: 2 }
	for (const [name, value] of singleEntries)
		if ((word & 0xfe0f) === value) return { name, d, size: 2 }
	if ((word & 0xf000) === 0xc000 || (word & 0xf000) === 0xd000)
		return { name: word & 0x1000 ? 'rcall' : 'rjmp', k: signed(word & 0xfff, 12), size: 2 }
	if ((word & 0xfc00) === 0xf000 || (word & 0xfc00) === 0xf400)
		return {
			name: 'branch',
			d: word & 7,
			r: (word >> 10) & 1,
			k: signed((word >> 3) & 127, 7),
			size: 2
		}
	if ((word & 0xfe0e) === 0x940c || (word & 0xfe0e) === 0x940e)
		return {
			name: word & 2 ? 'call' : 'jmp',
			k: (((word & 1) | ((word >> 3) & 0x3e)) * 65536 + second) * 2,
			size: 4
		}
	if ((word & 0xfe0f) === 0x9000 || (word & 0xfe0f) === 0x9200)
		return { name: word & 0x200 ? 'sts' : 'lds', d, k: second, size: 4 }
	if ((word & 0xf800) === 0xb000 || (word & 0xf800) === 0xb800)
		return { name: word & 0x800 ? 'out' : 'in', d, k: (word & 15) | ((word >> 5) & 48), size: 2 }
	if ((word & 0xff0f) === 0x9408 || (word & 0xff0f) === 0x9488)
		return { name: word & 0x80 ? 'bclr' : 'bset', k: (word >> 4) & 7, size: 2 }
	for (const [name, value] of bitEntries)
		if ((word & 0xfe08) === value) return { name, d, k: word & 7, size: 2 }
	// X, X+, -X; Y, Y+, -Y; Z, Z+, -Z.
	const low = word & 15
	if ((word & 0xfc00) === 0x9000 && [1, 2, 9, 10, 12, 13, 14].includes(low))
		return { name: word & 0x200 ? 'st' : 'ld', d, k: low, size: 2 }
	if ((word & 0xfc0f) === 0x8000 || (word & 0xfc0f) === 0x8008)
		return { name: word & 0x200 ? 'st' : 'ld', d, k: word & 8, size: 2 }
	throw new Error(`Unsupported AVR instruction 0x${word.toString(16).padStart(4, '0')}`)
}
export function format(i: Instruction, address = 0): string {
	if (i.name === 'ld' || i.name === 'st') {
		const pointer = (
			{
				0: 'Z',
				1: 'Z+',
				2: '-Z',
				8: 'Y',
				9: 'Y+',
				10: '-Y',
				12: 'X',
				13: 'X+',
				14: '-X'
			} as Record<number, string>
		)[i.k!]
		return i.name === 'ld' ? `ld r${i.d}, ${pointer}` : `st ${pointer}, r${i.d}`
	}
	if (i.name === 'branch')
		return `br${i.r ? 'bc' : 'bs'} ${i.d}, 0x${(address + 2 + i.k! * 2).toString(16)}`
	if (i.name === 'rjmp' || i.name === 'rcall')
		return `${i.name} 0x${(address + 2 + i.k! * 2).toString(16)}`
	if (i.name === 'out' || i.name === 'sts') return `${i.name} 0x${i.k!.toString(16)}, r${i.d}`
	const args = [
		i.d === undefined ? undefined : `r${i.d}`,
		i.r === undefined ? undefined : `r${i.r}`,
		i.k === undefined ? undefined : `0x${i.k.toString(16)}`
	].filter((value) => value !== undefined)
	return `${i.name}${args.length ? ' ' + args.join(', ') : ''}`
}
