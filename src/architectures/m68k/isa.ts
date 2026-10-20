import type { CpuModel } from './settings'

export const MEMORY_BYTES = 1024 * 1024
export const TEXT_BASE = 0x1000
export const DATA_BASE = 0x10000
export const REGISTER_NAMES = [
	...Array.from({ length: 8 }, (_, i) => `D${i}`),
	...Array.from({ length: 8 }, (_, i) => `A${i}`)
]
export const CONDITIONS = ['t', 'f', 'hi', 'ls', 'cc', 'cs', 'ne', 'eq', 'vc', 'vs', 'pl', 'mi', 'ge', 'lt', 'gt', 'le']
export const C = 1,
	V = 2,
	Z = 4,
	N = 8,
	X = 16
export function sign(value: number, size: number) {
	return size === 4 ? value | 0 : size === 2 ? (value << 16) >> 16 : (value << 24) >> 24
}
export function mask(size: number) {
	return size === 4 ? 0xffffffff : size === 2 ? 0xffff : 255
}
export function condition(code: number, ccr: number): boolean {
	const c = !!(ccr & C),
		v = !!(ccr & V),
		z = !!(ccr & Z),
		n = !!(ccr & N)
	return [true, false, !c && !z, c || z, !c, c, !z, z, !v, v, !n, n, n === v, n !== v, !z && n === v, z || n !== v][
		code
	]
}
export function conditionCode(name: string): number {
	if (name === 'hs') return 4
	if (name === 'lo') return 5
	const code = CONDITIONS.indexOf(name)
	if (code < 0) throw new Error(`Unknown condition '${name}'`)
	return code
}
export function requireModel(model: CpuModel, minimum: CpuModel, name: string) {
	if (+model < +minimum) throw new Error(`${name} requires MC${minimum} or later`)
}
export interface EffectiveAddress {
	mode: number
	reg: number
	extension: number[]
	/** Text is informational only; execution decodes the actual words. */
	text?: string
}
export const sizeCode = (size: number) => (size === 1 ? 0 : size === 2 ? 1 : 2)
export function wordsToBytes(words: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(words.length * 2),
		view = new DataView(bytes.buffer)
	words.forEach((word, i) => view.setUint16(i * 2, word, false))
	return bytes
}
export function longWords(value: number) {
	return [value >>> 16, value & 0xffff]
}
export function dataRegister(text: string) {
	if (!/^d[0-7]$/i.test(text)) throw new Error(`Expected data register, got '${text}'`)
	return Number(text[1])
}
export function addressRegister(text: string) {
	if (/^sp$/i.test(text)) return 7
	if (!/^a[0-7]$/i.test(text)) throw new Error(`Expected address register, got '${text}'`)
	return Number(text[1])
}
export const MNEMONICS = [
	'move',
	'movea',
	'moveq',
	'movem',
	'lea',
	'pea',
	'add',
	'sub',
	'cmp',
	'adda',
	'suba',
	'cmpa',
	'and',
	'or',
	'eor',
	'addi',
	'subi',
	'cmpi',
	'andi',
	'ori',
	'eori',
	'addq',
	'subq',
	'clr',
	'tst',
	'neg',
	'not',
	'swap',
	'exg',
	'ext',
	'extb',
	'muls',
	'mulu',
	'divs',
	'divu',
	'asl',
	'asr',
	'lsl',
	'lsr',
	'rol',
	'ror',
	'roxl',
	'roxr',
	'btst',
	'bchg',
	'bclr',
	'bset',
	'bra',
	'bsr',
	'jmp',
	'jsr',
	'rts',
	'rtd',
	'link',
	'unlk',
	'trap',
	'nop',
	'illegal',
	'bkpt',
	...CONDITIONS.flatMap((cc) => [`b${cc}`, `db${cc}`, `s${cc}`]),
	'dbra'
]
