/**
 * System/360 and System/370 problem-state instructions (GA22-6821, GA22-7000).
 * Opcodes, formats and feature gating live in one table; execution dispatches
 * on the integer opcode.
 */
import type { CpuContext, CpuInstruction } from '../../core/configuredCpu'
import { ebcdicText } from './ebcdic'
import { isPlus, packDecimal, truncateDecimal, unpackDecimal } from './decimal'
import * as hfp from './hfp'
import {
	ADDRESSING, DATA, DECIMAL_DIVIDE, DECIMAL_OVERFLOW, EXECUTE, FIXED_DIVIDE, FIXED_OVERFLOW, interrupt,
	MASK_DECIMAL, MASK_FIXED, OPERATION, SPECIFICATION,
} from './interruption'

/** Native register words: GPRs, the four FPRs as high/low word pairs, then PSW fields. */
export const FPR = 16, CC = 24, PM = 25, IA = 26, REGISTER_WORDS = 27

/** Optional features and the System/370 additions an instruction requires. */
export const DECIMAL = 1, FLOAT = 2, S370 = 4

/** Operand shapes, shared by the assembler, the decoder and the help text. */
export const RR = 0, RR1 = 1, RRI = 2, RRX = 3, RX = 4, RXX = 5, RS = 6, RSH = 7, SI = 8, SI1 = 9, SSL = 10, SSLL = 11, SSRP = 12

export interface Opcode { name: string, op: number, shape: number, requires: number, mask?: number }

const table: [string, number, number, number][] = [
	['SPM', 0x04, RR1, 0], ['BALR', 0x05, RR, 0], ['BCTR', 0x06, RR, 0], ['BCR', 0x07, RR, 0], ['SVC', 0x0a, RRI, 0],
	['MVCL', 0x0e, RR, S370], ['CLCL', 0x0f, RR, S370],
	['LPR', 0x10, RR, 0], ['LNR', 0x11, RR, 0], ['LTR', 0x12, RR, 0], ['LCR', 0x13, RR, 0], ['NR', 0x14, RR, 0], ['CLR', 0x15, RR, 0],
	['OR', 0x16, RR, 0], ['XR', 0x17, RR, 0], ['LR', 0x18, RR, 0], ['CR', 0x19, RR, 0], ['AR', 0x1a, RR, 0], ['SR', 0x1b, RR, 0],
	['MR', 0x1c, RR, 0], ['DR', 0x1d, RR, 0], ['ALR', 0x1e, RR, 0], ['SLR', 0x1f, RR, 0],
	['LPDR', 0x20, RR, FLOAT], ['LNDR', 0x21, RR, FLOAT], ['LTDR', 0x22, RR, FLOAT], ['LCDR', 0x23, RR, FLOAT], ['HDR', 0x24, RR, FLOAT],
	['LRDR', 0x25, RR, FLOAT | S370], ['MXR', 0x26, RR, FLOAT | S370], ['MXDR', 0x27, RR, FLOAT | S370],
	['LDR', 0x28, RR, FLOAT], ['CDR', 0x29, RR, FLOAT], ['ADR', 0x2a, RR, FLOAT], ['SDR', 0x2b, RR, FLOAT], ['MDR', 0x2c, RR, FLOAT],
	['DDR', 0x2d, RR, FLOAT], ['AWR', 0x2e, RR, FLOAT], ['SWR', 0x2f, RR, FLOAT],
	['LPER', 0x30, RR, FLOAT], ['LNER', 0x31, RR, FLOAT], ['LTER', 0x32, RR, FLOAT], ['LCER', 0x33, RR, FLOAT], ['HER', 0x34, RR, FLOAT],
	['LRER', 0x35, RR, FLOAT | S370], ['AXR', 0x36, RR, FLOAT | S370], ['SXR', 0x37, RR, FLOAT | S370],
	['LER', 0x38, RR, FLOAT], ['CER', 0x39, RR, FLOAT], ['AER', 0x3a, RR, FLOAT], ['SER', 0x3b, RR, FLOAT], ['MER', 0x3c, RR, FLOAT],
	['DER', 0x3d, RR, FLOAT], ['AUR', 0x3e, RR, FLOAT], ['SUR', 0x3f, RR, FLOAT],
	['STH', 0x40, RX, 0], ['LA', 0x41, RX, 0], ['STC', 0x42, RX, 0], ['IC', 0x43, RX, 0], ['EX', 0x44, RX, 0], ['BAL', 0x45, RX, 0],
	['BCT', 0x46, RX, 0], ['BC', 0x47, RX, 0], ['LH', 0x48, RX, 0], ['CH', 0x49, RX, 0], ['AH', 0x4a, RX, 0], ['SH', 0x4b, RX, 0],
	['MH', 0x4c, RX, 0], ['CVD', 0x4e, RX, 0], ['CVB', 0x4f, RX, 0], ['ST', 0x50, RX, 0], ['N', 0x54, RX, 0], ['CL', 0x55, RX, 0],
	['O', 0x56, RX, 0], ['X', 0x57, RX, 0], ['L', 0x58, RX, 0], ['C', 0x59, RX, 0], ['A', 0x5a, RX, 0], ['S', 0x5b, RX, 0],
	['M', 0x5c, RX, 0], ['D', 0x5d, RX, 0], ['AL', 0x5e, RX, 0], ['SL', 0x5f, RX, 0],
	['STD', 0x60, RX, FLOAT], ['MXD', 0x67, RX, FLOAT | S370], ['LD', 0x68, RX, FLOAT], ['CD', 0x69, RX, FLOAT], ['AD', 0x6a, RX, FLOAT],
	['SD', 0x6b, RX, FLOAT], ['MD', 0x6c, RX, FLOAT], ['DD', 0x6d, RX, FLOAT], ['AW', 0x6e, RX, FLOAT], ['SW', 0x6f, RX, FLOAT],
	['STE', 0x70, RX, FLOAT], ['LE', 0x78, RX, FLOAT], ['CE', 0x79, RX, FLOAT], ['AE', 0x7a, RX, FLOAT], ['SE', 0x7b, RX, FLOAT],
	['ME', 0x7c, RX, FLOAT], ['DE', 0x7d, RX, FLOAT], ['AU', 0x7e, RX, FLOAT], ['SU', 0x7f, RX, FLOAT],
	['BXH', 0x86, RS, 0], ['BXLE', 0x87, RS, 0], ['SRL', 0x88, RSH, 0], ['SLL', 0x89, RSH, 0], ['SRA', 0x8a, RSH, 0], ['SLA', 0x8b, RSH, 0],
	['SRDL', 0x8c, RSH, 0], ['SLDL', 0x8d, RSH, 0], ['SRDA', 0x8e, RSH, 0], ['SLDA', 0x8f, RSH, 0], ['STM', 0x90, RS, 0], ['TM', 0x91, SI, 0],
	['MVI', 0x92, SI, 0], ['TS', 0x93, SI1, 0], ['NI', 0x94, SI, 0], ['CLI', 0x95, SI, 0], ['OI', 0x96, SI, 0], ['XI', 0x97, SI, 0], ['LM', 0x98, RS, 0],
	['CLM', 0xbd, RS, S370], ['STCM', 0xbe, RS, S370], ['ICM', 0xbf, RS, S370],
	['MVN', 0xd1, SSL, 0], ['MVC', 0xd2, SSL, 0], ['MVZ', 0xd3, SSL, 0], ['NC', 0xd4, SSL, 0], ['CLC', 0xd5, SSL, 0], ['OC', 0xd6, SSL, 0],
	['XC', 0xd7, SSL, 0], ['TR', 0xdc, SSL, 0], ['TRT', 0xdd, SSL, 0], ['ED', 0xde, SSL, DECIMAL], ['EDMK', 0xdf, SSL, DECIMAL],
	['SRP', 0xf0, SSRP, DECIMAL | S370], ['MVO', 0xf1, SSLL, 0], ['PACK', 0xf2, SSLL, 0], ['UNPK', 0xf3, SSLL, 0],
	['ZAP', 0xf8, SSLL, DECIMAL], ['CP', 0xf9, SSLL, DECIMAL], ['AP', 0xfa, SSLL, DECIMAL], ['SP', 0xfb, SSLL, DECIMAL],
	['MP', 0xfc, SSLL, DECIMAL], ['DP', 0xfd, SSLL, DECIMAL],
]
/** Extended branch mnemonics and their BC/BCR masks (GC33-4010, "Extended Mnemonic Codes"). */
const extended: [string, number][] = [
	['B', 15], ['NOP', 0], ['BH', 2], ['BL', 4], ['BE', 8], ['BNH', 13], ['BNL', 11], ['BNE', 7],
	['BO', 1], ['BP', 2], ['BM', 4], ['BZ', 8], ['BNP', 13], ['BNM', 11], ['BNZ', 7], ['BNO', 14],
]

export const opcodes = new Map<string, Opcode>()
const byCode: (Opcode | undefined)[] = new Array(256)
for (const [name, op, shape, requires] of table) { const entry = { name, op, shape, requires }; opcodes.set(name, entry); byCode[op] = entry }
for (const [name, mask] of extended) {
	opcodes.set(name, { name, op: 0x47, shape: RXX, requires: 0, mask })
	opcodes.set(name === 'NOP' ? 'NOPR' : `${name}R`, { name: name === 'NOP' ? 'NOPR' : `${name}R`, op: 0x07, shape: RRX, requires: 0, mask })
}

/** Instruction length from the first two opcode bits: 2, 4, 4 or 6 bytes. */
export const lengthOf = (op: number) => op < 0x40 ? 2 : op < 0xc0 ? 4 : 6

export interface Model { features: number }
export const hasFeatures = (model: Model, requires: number) => (requires & ~model.features) === 0

/* ------------------------------------------------------------- execution */

const signed = (value: number) => value | 0
const setCC = (c: CpuContext, code: number) => { c.r[CC] = code }
const signCode = (value: number) => value === 0 ? 0 : value < 0 ? 1 : 2

function checkAddress(c: CpuContext, address: number, length: number, align: number, aligned: boolean) {
	if (address + length > c.memory.length) interrupt(ADDRESSING, `address ${address.toString(16).toUpperCase().padStart(6, '0')}`)
	if (aligned && align > 1 && address % align) interrupt(SPECIFICATION, 'operand alignment')
}
const even = (r: number) => { if (r & 1) interrupt(SPECIFICATION, 'odd register of an even/odd pair') }
const floatRegister = (r: number) => { if (r & 1 || r > 6) interrupt(SPECIFICATION, 'floating-point register must be 0, 2, 4 or 6') }
const extendedRegister = (r: number) => { if (r !== 0 && r !== 4) interrupt(SPECIFICATION, 'extended operands use register 0 or 4') }

function fixedOverflow(c: CpuContext) {
	setCC(c, 3)
	if (c.r[PM] & MASK_FIXED) interrupt(FIXED_OVERFLOW)
}
function addSigned(c: CpuContext, a: number, b: number): number {
	const sum = signed(a) + signed(b), result = sum | 0
	if (sum !== result) fixedOverflow(c)
	else setCC(c, signCode(result))
	return result >>> 0
}
function subtractSigned(c: CpuContext, a: number, b: number): number {
	const difference = signed(a) - signed(b), result = difference | 0
	if (difference !== result) fixedOverflow(c)
	else setCC(c, signCode(result))
	return result >>> 0
}
/** Logical add/subtract: CC is carry * 2 + nonzero. Subtraction adds the one's complement plus one. */
function addLogical(c: CpuContext, a: number, b: number, carryIn = 0): number {
	const sum = (a >>> 0) + (b >>> 0) + carryIn, result = sum >>> 0
	setCC(c, (sum > 0xffffffff ? 2 : 0) + (result ? 1 : 0))
	return result
}
const compareSigned = (a: number, b: number) => signed(a) === signed(b) ? 0 : signed(a) < signed(b) ? 1 : 2
const compareLogical = (a: number, b: number) => (a >>> 0) === (b >>> 0) ? 0 : (a >>> 0) < (b >>> 0) ? 1 : 2

const pair = (c: CpuContext, r: number) => BigInt.asIntN(64, BigInt(c.r[r]) << 32n | BigInt(c.r[r + 1]))
function setPair(c: CpuContext, r: number, value: bigint) {
	const bits = BigInt.asUintN(64, value)
	c.r[r] = Number(bits >> 32n); c.r[r + 1] = Number(bits & 0xffffffffn)
}

const shortOf = (c: CpuContext, r: number) => hfp.fromShort(c.r[FPR + r])
const setShort = (c: CpuContext, r: number, value: hfp.Hfp) => { c.r[FPR + r] = hfp.toShort(value) }
const longBits = (c: CpuContext, r: number) => BigInt(c.r[FPR + r]) << 32n | BigInt(c.r[FPR + r + 1])
const longOf = (c: CpuContext, r: number) => hfp.fromLong(longBits(c, r))
function setLongBits(c: CpuContext, r: number, bits: bigint) { c.r[FPR + r] = Number(bits >> 32n); c.r[FPR + r + 1] = Number(bits & 0xffffffffn) }
const setLong = (c: CpuContext, r: number, value: hfp.Hfp) => setLongBits(c, r, hfp.toLong(value))
const extendedOf = (c: CpuContext, r: number) => hfp.fromExtended(longBits(c, r), longBits(c, r + 2))
function setExtended(c: CpuContext, r: number, value: hfp.Hfp) { const [high, low] = hfp.toExtended(value); setLongBits(c, r, high); setLongBits(c, r + 2, low) }

function readBytes(c: CpuContext, address: number, length: number): number[] {
	const bytes = new Array<number>(length)
	for (let i = 0; i < length; i++) bytes[i] = c.read(address + i)
	return bytes
}
function writeBytes(c: CpuContext, address: number, bytes: readonly number[]) { for (let i = 0; i < bytes.length; i++) c.write(address + i, bytes[i]) }

/** The THRAX supervisor: OS/360 EXIT and WTO, plus teaching console services. */
function supervisor(c: CpuContext, code: number) {
	switch (code) {
		case 3: c.halt(); break
		case 35: {
			const list = c.r[1] & 0xffffff
			checkAddress(c, list, 4, 1, false)
			const length = c.read(list, 2)
			if (length < 4) throw new Error('WTO parameter list length must include its 4-byte prefix')
			checkAddress(c, list, length, 1, false)
			c.output(`${ebcdicText(readBytes(c, list + 4, length - 4))}\n`)
			break
		}
		case 200: c.output(String(signed(c.r[1]))); break
		case 201: c.r[1] = c.inputInteger(32) >>> 0; break
		case 202: c.output(ebcdicText([c.r[1] & 255])); break
		case 203: {
			const address = c.r[1] & 0xffffff, length = c.r[0] & 0xffffff
			checkAddress(c, address, length, 1, false)
			c.output(ebcdicText(readBytes(c, address, length)))
			break
		}
		default: throw new Error(`Unsupported THRAX supervisor call SVC ${code}`)
	}
}

interface Fields { op: number, r1: number, r2: number, x2: number, b1: number, d1: number, b2: number, d2: number, l1: number, l2: number, i2: number, size: number }

/** EDIT and EDIT AND MARK (GA22-6821, "Edit"). */
function edit(c: CpuContext, f: Fields, a1: number, a2: number, mark: boolean) {
	const length = f.l1 + 1
	const pattern = readBytes(c, a1, length), fill = pattern[0]
	let source = a2, high = true, significant = false, zero = true, marked = -1
	for (let i = 0; i < length; i++) {
		const p = pattern[i]
		if (p === 0x20 || p === 0x21) {
			checkAddress(c, source, 1, 1, false)
			const byte = c.read(source), digit = high ? byte >> 4 : byte & 15
			if (digit > 9) interrupt(DATA, 'invalid digit in an edited field')
			if (digit) zero = false
			if (significant) pattern[i] = 0xf0 | digit
			else if (digit) { pattern[i] = 0xf0 | digit; significant = true; marked = a1 + i }
			else { pattern[i] = fill; if (p === 0x21) significant = true }
			if (high && (byte & 15) >= 10) { if (isPlus(byte & 15)) significant = false; source++ }
			else if (high) high = false
			else { high = true; source++ }
		} else if (p === 0x22) { pattern[i] = fill; significant = false; zero = true }
		else if (!significant) pattern[i] = fill
	}
	writeBytes(c, a1, pattern)
	setCC(c, zero ? 0 : significant ? 1 : 2)
	if (mark && marked >= 0) c.r[1] = (c.r[1] & 0xff000000 | marked) >>> 0
}

function decimalOverflow(c: CpuContext) {
	setCC(c, 3)
	if (c.r[PM] & MASK_DECIMAL) interrupt(DECIMAL_OVERFLOW)
}
/** Store a decimal result in `length` bytes with AP/SP/ZAP/SRP condition codes. */
function storeDecimal(c: CpuContext, address: number, length: number, value: bigint) {
	const kept = truncateDecimal(value, length), overflow = kept !== value
	writeBytes(c, address, packDecimal(kept, length, overflow && value < 0n).bytes)
	if (overflow) decimalOverflow(c)
	else setCC(c, kept === 0n ? 0 : kept < 0n ? 1 : 2)
}

function execute(c: CpuContext, f: Fields, model: Model, ilc: number) {
	const { op, r1, r2 } = f
	const aligned = !(model.features & S370)
	const rx = () => ((f.x2 ? c.r[f.x2] : 0) + (f.b2 ? c.r[f.b2] : 0) + f.d2) & 0xffffff
	const first = () => ((f.b1 ? c.r[f.b1] : 0) + f.d1) & 0xffffff
	const second = () => ((f.b2 ? c.r[f.b2] : 0) + f.d2) & 0xffffff
	const word = (address: number) => { checkAddress(c, address, 4, 4, aligned); return c.read(address, 4) }
	const half = (address: number) => { checkAddress(c, address, 2, 2, aligned); return c.read(address, 2) << 16 >> 16 }
	const storeWord = (address: number, value: number) => { checkAddress(c, address, 4, 4, aligned); c.write(address, value >>> 0, 4) }
	const long = (address: number) => { checkAddress(c, address, 8, 8, aligned); return c.readWide(address) }
	const operand = (address: number, length: number) => { checkAddress(c, address, length, 1, false); return readBytes(c, address, length) }
	const store = (address: number, bytes: readonly number[]) => { checkAddress(c, address, bytes.length, 1, false); writeBytes(c, address, bytes) }
	const branch = (target: number, taken: boolean) => {
		if (taken && target & 1) interrupt(SPECIFICATION, 'odd branch address')
		c.branch(target, taken)
	}
	const link = (target: number) => { c.r[r1] = (ilc << 30 | c.r[CC] << 28 | c.r[PM] << 24 | c.pc) >>> 0; return target }
	const floatResult = (r: number, value: hfp.Hfp, long: boolean) => { if (long) setLong(c, r, value); else setShort(c, r, value); setCC(c, hfp.resultCode(value)) }
	const mask = c.r[PM]
	switch (op) {
		case 0x04: c.r[CC] = c.r[r1] >>> 28 & 3; c.r[PM] = c.r[r1] >>> 24 & 15; return
		case 0x05: { const target = c.r[r2] & 0xffffff; link(target); if (r2) { if (target & 1) interrupt(SPECIFICATION, 'odd branch address'); c.call(target) } return }
		case 0x06: { const target = c.r[r2] & 0xffffff; c.r[r1] = c.r[r1] - 1 >>> 0; if (r2) branch(target, c.r[r1] !== 0) } return
		case 0x07: {
			if (!r2) return
			const target = c.r[r2] & 0xffffff, taken = !!(r1 & 8 >> c.r[CC])
			branch(target, taken)
			if (taken) c.ret(target)
			return
		}
		case 0x0a: supervisor(c, f.i2); return
		case 0x0e: case 0x0f: {
			even(r1); even(r2)
			let a1 = c.r[r1] & 0xffffff, n1 = c.r[r1 + 1] & 0xffffff, a2 = c.r[r2] & 0xffffff, n2 = c.r[r2 + 1] & 0xffffff
			const pad = c.r[r2 + 1] >>> 24
			if (op === 0x0e) {
				const moved = Math.min(n1, n2)
				if (moved && a1 > a2 && a1 < a2 + moved) { setCC(c, 3); return }
				setCC(c, compareLogical(n1, n2))
				for (; n1; n1--, a1++) {
					checkAddress(c, a1, 1, 1, false)
					let byte = pad
					if (n2) { checkAddress(c, a2, 1, 1, false); byte = c.read(a2); a2++; n2-- }
					c.write(a1, byte)
				}
				c.r[r1] = (c.r[r1] & 0xff000000 | a1) >>> 0; c.r[r1 + 1] = c.r[r1 + 1] & 0xff000000
				c.r[r2] = (c.r[r2] & 0xff000000 | a2) >>> 0; c.r[r2 + 1] = (c.r[r2 + 1] & 0xff000000 | n2) >>> 0
				return
			}
			let code = 0
			while (n1 || n2) {
				if (n1) checkAddress(c, a1, 1, 1, false)
				if (n2) checkAddress(c, a2, 1, 1, false)
				const x = n1 ? c.read(a1) : pad, y = n2 ? c.read(a2) : pad
				if (x !== y) { code = x < y ? 1 : 2; break }
				if (n1) { a1++; n1-- }
				if (n2) { a2++; n2-- }
			}
			setCC(c, code)
			c.r[r1] = (c.r[r1] & 0xff000000 | a1) >>> 0; c.r[r1 + 1] = (c.r[r1 + 1] & 0xff000000 | n1) >>> 0
			c.r[r2] = (c.r[r2] & 0xff000000 | a2) >>> 0; c.r[r2 + 1] = (c.r[r2 + 1] & 0xff000000 | n2) >>> 0
			return
		}
		case 0x10: { const value = signed(c.r[r2]); if (value === -0x80000000) { c.r[r1] = c.r[r2]; fixedOverflow(c) } else { c.r[r1] = Math.abs(value); setCC(c, value ? 2 : 0) } return }
		case 0x11: { const value = -Math.abs(signed(c.r[r2])) | 0; c.r[r1] = value >>> 0; setCC(c, value ? 1 : 0); return }
		case 0x12: c.r[r1] = c.r[r2]; setCC(c, signCode(signed(c.r[r1]))); return
		case 0x13: { const value = signed(c.r[r2]); if (value === -0x80000000) { c.r[r1] = c.r[r2]; fixedOverflow(c) } else { c.r[r1] = -value >>> 0; setCC(c, signCode(-value)) } return }
		case 0x14: case 0x54: case 0x16: case 0x56: case 0x17: case 0x57: {
			const value = op < 0x40 ? c.r[r2] : word(rx()), kind = op & 0xf
			c.r[r1] = (kind === 4 ? c.r[r1] & value : kind === 6 ? c.r[r1] | value : c.r[r1] ^ value) >>> 0
			setCC(c, c.r[r1] ? 1 : 0)
			return
		}
		case 0x15: setCC(c, compareLogical(c.r[r1], c.r[r2])); return
		case 0x55: setCC(c, compareLogical(c.r[r1], word(rx()))); return
		case 0x18: c.r[r1] = c.r[r2]; return
		case 0x19: setCC(c, compareSigned(c.r[r1], c.r[r2])); return
		case 0x59: setCC(c, compareSigned(c.r[r1], word(rx()))); return
		case 0x49: setCC(c, compareSigned(c.r[r1], half(rx()))); return
		case 0x1a: c.r[r1] = addSigned(c, c.r[r1], c.r[r2]); return
		case 0x5a: c.r[r1] = addSigned(c, c.r[r1], word(rx())); return
		case 0x4a: c.r[r1] = addSigned(c, c.r[r1], half(rx())); return
		case 0x1b: c.r[r1] = subtractSigned(c, c.r[r1], c.r[r2]); return
		case 0x5b: c.r[r1] = subtractSigned(c, c.r[r1], word(rx())); return
		case 0x4b: c.r[r1] = subtractSigned(c, c.r[r1], half(rx())); return
		case 0x1e: c.r[r1] = addLogical(c, c.r[r1], c.r[r2]); return
		case 0x5e: c.r[r1] = addLogical(c, c.r[r1], word(rx())); return
		case 0x1f: c.r[r1] = addLogical(c, c.r[r1], ~c.r[r2], 1); return
		case 0x5f: c.r[r1] = addLogical(c, c.r[r1], ~word(rx()), 1); return
		case 0x1c: case 0x5c: {
			even(r1)
			const value = op === 0x1c ? c.r[r2] : word(rx())
			setPair(c, r1, BigInt(signed(c.r[r1 + 1])) * BigInt(signed(value)))
			return
		}
		case 0x4c: c.r[r1] = Math.imul(c.r[r1], half(rx())) >>> 0; return
		case 0x1d: case 0x5d: {
			even(r1)
			const divisor = BigInt(signed(op === 0x1d ? c.r[r2] : word(rx())))
			if (!divisor) interrupt(FIXED_DIVIDE, 'divisor is zero')
			const dividend = pair(c, r1), quotient = dividend / divisor
			if (quotient !== BigInt.asIntN(32, quotient)) interrupt(FIXED_DIVIDE, 'quotient exceeds 32 bits')
			c.r[r1] = Number(BigInt.asUintN(32, dividend % divisor)); c.r[r1 + 1] = Number(BigInt.asUintN(32, quotient))
			return
		}
		case 0x40: { const address = rx(); checkAddress(c, address, 2, 2, aligned); c.write(address, c.r[r1] & 0xffff, 2); return }
		case 0x41: c.r[r1] = rx(); return
		case 0x42: { const address = rx(); checkAddress(c, address, 1, 1, false); c.write(address, c.r[r1] & 255); return }
		case 0x43: { const address = rx(); checkAddress(c, address, 1, 1, false); c.r[r1] = (c.r[r1] & 0xffffff00 | c.read(address)) >>> 0; return }
		case 0x44: {
			const target = rx()
			if (target & 1) interrupt(SPECIFICATION, 'odd execute target')
			checkAddress(c, target, 2, 1, false)
			const length = lengthOf(c.read(target))
			checkAddress(c, target, length, 1, false)
			const bytes = new Uint8Array(readBytes(c, target, length))
			if (bytes[0] === 0x44) interrupt(EXECUTE, 'EX may not target EX')
			if (r1) bytes[1] |= c.r[r1] & 255
			decodeInstruction(bytes, 0, model, 2).execute(c)
			return
		}
		case 0x45: { const target = link(rx()); if (target & 1) interrupt(SPECIFICATION, 'odd branch address'); c.call(target); return }
		case 0x46: { const target = rx(); c.r[r1] = c.r[r1] - 1 >>> 0; branch(target, c.r[r1] !== 0); return }
		case 0x47: if (r1) branch(rx(), !!(r1 & 8 >> c.r[CC])); return
		case 0x48: c.r[r1] = half(rx()) >>> 0; return
		case 0x4e: { const address = rx(); checkAddress(c, address, 8, 8, aligned); writeBytes(c, address, packDecimal(BigInt(signed(c.r[r1])), 8).bytes); return }
		case 0x4f: {
			const address = rx(); checkAddress(c, address, 8, 8, aligned)
			const value = unpackDecimal(readBytes(c, address, 8))
			if (value !== BigInt.asIntN(32, value)) interrupt(FIXED_DIVIDE, 'CVB result exceeds 32 bits')
			c.r[r1] = Number(BigInt.asUintN(32, value))
			return
		}
		case 0x50: storeWord(rx(), c.r[r1]); return
		case 0x58: c.r[r1] = word(rx()); return
		case 0x86: case 0x87: {
			const target = second(), increment = signed(c.r[f.x2]), limit = signed(c.r[f.x2 | 1])
			const sum = signed(c.r[r1]) + increment | 0
			c.r[r1] = sum >>> 0
			branch(target, op === 0x86 ? sum > limit : sum <= limit)
			return
		}
		case 0x88: case 0x89: case 0x8a: case 0x8b: {
			const count = second() & 63, value = c.r[r1]
			if (op === 0x88) c.r[r1] = count > 31 ? 0 : value >>> count
			else if (op === 0x89) c.r[r1] = count > 31 ? 0 : value << count >>> 0
			else if (op === 0x8a) { c.r[r1] = signed(value) >> Math.min(count, 31) >>> 0; setCC(c, signCode(signed(c.r[r1]))) }
			else {
				const shifted = BigInt(signed(value)) << BigInt(count), result = (value & 0x80000000 | Number(shifted & 0x7fffffffn)) >>> 0
				c.r[r1] = result
				if (shifted !== BigInt.asIntN(32, shifted)) fixedOverflow(c)
				else setCC(c, signCode(signed(result)))
			}
			return
		}
		case 0x8c: case 0x8d: case 0x8e: case 0x8f: {
			even(r1)
			const count = BigInt(second() & 63), value = pair(c, r1)
			if (op === 0x8c) setPair(c, r1, BigInt.asUintN(64, value) >> count)
			else if (op === 0x8d) setPair(c, r1, value << count)
			else if (op === 0x8e) { const result = value >> count; setPair(c, r1, result); setCC(c, result === 0n ? 0 : result < 0n ? 1 : 2) }
			else {
				const shifted = value << count, result = BigInt.asIntN(64, value & -0x8000000000000000n | shifted & 0x7fffffffffffffffn)
				setPair(c, r1, result)
				if (shifted !== BigInt.asIntN(64, shifted)) fixedOverflow(c)
				else setCC(c, result === 0n ? 0 : result < 0n ? 1 : 2)
			}
			return
		}
		case 0x90: case 0x98: {
			const address = second(), count = (f.x2 - r1 & 15) + 1
			checkAddress(c, address, 4 * count, 4, aligned)
			for (let i = 0; i < count; i++) {
				const r = r1 + i & 15
				if (op === 0x90) c.write(address + 4 * i, c.r[r], 4)
				else c.r[r] = c.read(address + 4 * i, 4)
			}
			return
		}
		case 0x91: case 0x92: case 0x94: case 0x95: case 0x96: case 0x97: {
			const address = first()
			checkAddress(c, address, 1, 1, false)
			if (op === 0x92) { c.write(address, f.i2); return }
			const value = c.read(address)
			if (op === 0x91) { const selected = value & f.i2; setCC(c, selected === 0 ? 0 : selected === f.i2 ? 3 : 1); return }
			if (op === 0x95) { setCC(c, compareLogical(value, f.i2)); return }
			const result = op === 0x94 ? value & f.i2 : op === 0x96 ? value | f.i2 : value ^ f.i2
			c.write(address, result); setCC(c, result ? 1 : 0)
			return
		}
		case 0x93: { const address = first(); checkAddress(c, address, 1, 1, false); setCC(c, c.read(address) >> 7); c.write(address, 0xff); return }
		case 0xbd: case 0xbe: case 0xbf: {
			const m = f.x2, count = (m >> 3 & 1) + (m >> 2 & 1) + (m >> 1 & 1) + (m & 1), address = second()
			const bytes = count ? operand(address, count) : []
			let at = 0, code = 0, first = true
			for (let i = 0; i < 4; i++) {
				if (!(m & 8 >> i)) continue
				const shift = 24 - 8 * i, own = c.r[r1] >>> shift & 255
				if (op === 0xbe) bytes[at] = own
				else if (op === 0xbd) { if (!code && own !== bytes[at]) code = own < bytes[at] ? 1 : 2 }
				else {
					c.r[r1] = (c.r[r1] & ~(255 << shift) | bytes[at] << shift) >>> 0
					if (bytes[at]) code = code || (first && bytes[at] & 0x80 ? 1 : 2)
					first = false
				}
				at++
			}
			if (op === 0xbe) store(address, bytes)
			else setCC(c, code)
			return
		}
		case 0xd1: case 0xd2: case 0xd3: case 0xd4: case 0xd6: case 0xd7: case 0xdc: {
			const a1 = first(), a2 = second(), length = f.l1 + 1
			checkAddress(c, a1, length, 1, false)
			if (op !== 0xdc) checkAddress(c, a2, length, 1, false)
			let nonzero = false
			for (let i = 0; i < length; i++) {
				const target = c.read(a1 + i)
				let value: number
				if (op === 0xdc) { checkAddress(c, a2 + target, 1, 1, false); value = c.read(a2 + target) }
				else {
					const source = c.read(a2 + i)
					value = op === 0xd2 ? source : op === 0xd1 ? target & 0xf0 | source & 15 : op === 0xd3 ? source & 0xf0 | target & 15
						: op === 0xd4 ? target & source : op === 0xd6 ? target | source : target ^ source
				}
				if (value) nonzero = true
				c.write(a1 + i, value)
			}
			if (op === 0xd4 || op === 0xd6 || op === 0xd7) setCC(c, nonzero ? 1 : 0)
			return
		}
		case 0xd5: {
			const length = f.l1 + 1, x = operand(first(), length), y = operand(second(), length)
			let code = 0
			for (let i = 0; i < length && !code; i++) if (x[i] !== y[i]) code = x[i] < y[i] ? 1 : 2
			setCC(c, code)
			return
		}
		case 0xdd: {
			const a1 = first(), a2 = second(), length = f.l1 + 1
			checkAddress(c, a1, length, 1, false)
			for (let i = 0; i < length; i++) {
				const at = a2 + c.read(a1 + i)
				checkAddress(c, at, 1, 1, false)
				const value = c.read(at)
				if (value) {
					c.r[1] = (c.r[1] & 0xff000000 | a1 + i) >>> 0
					c.r[2] = (c.r[2] & 0xffffff00 | value) >>> 0
					setCC(c, i === length - 1 ? 2 : 1)
					return
				}
			}
			setCC(c, 0)
			return
		}
		case 0xde: case 0xdf: edit(c, f, first(), second(), op === 0xdf); return
		case 0xf0: {
			const a1 = first(), length = f.l1 + 1, shift = second() << 26 >> 26, rounding = f.l2
			if (rounding > 9) interrupt(DATA, 'SRP rounding digit')
			const value = unpackDecimal(operand(a1, length))
			let result: bigint
			if (shift >= 0) result = value * 10n ** BigInt(shift)
			else {
				const scale = 10n ** BigInt(-shift), magnitude = (value < 0n ? -value : value) * 10n / scale
				const rounded = (magnitude + BigInt(rounding)) / 10n
				result = value < 0n ? -rounded : rounded
			}
			storeDecimal(c, a1, length, result)
			return
		}
		case 0xf1: case 0xf2: case 0xf3: {
			const a1 = first(), a2 = second(), n1 = f.l1 + 1, n2 = f.l2 + 1
			const source = operand(a2, n2), target = operand(a1, n1)
			const nibbles: number[] = []
			if (op === 0xf1) { for (const byte of source) nibbles.push(byte >> 4, byte & 15); nibbles.push(target[n1 - 1] & 15) }
			else if (op === 0xf2) { for (let i = 0; i < n2 - 1; i++) nibbles.push(source[i] & 15); nibbles.push(source[n2 - 1] & 15, source[n2 - 1] >> 4) }
			if (op !== 0xf3) {
				const result = new Array<number>(n1).fill(0)
				for (let i = 0; i < 2 * n1 && i < nibbles.length; i++) {
					const nibble = nibbles[nibbles.length - 1 - i], byte = n1 - 1 - (i >> 1)
					result[byte] |= i & 1 ? nibble << 4 : nibble
				}
				store(a1, result)
				return
			}
			const digits: number[] = []
			for (let i = 0; i < n2 - 1; i++) digits.push(source[i] >> 4, source[i] & 15)
			digits.push(source[n2 - 1] >> 4)
			const result = new Array<number>(n1).fill(0xf0)
			result[n1 - 1] = (source[n2 - 1] & 15) << 4 | source[n2 - 1] >> 4
			for (let i = 1; i < n1 && i < digits.length; i++) result[n1 - 1 - i] = 0xf0 | digits[digits.length - 1 - i]
			store(a1, result)
			return
		}
		case 0xf8: case 0xf9: case 0xfa: case 0xfb: case 0xfc: case 0xfd: {
			const a1 = first(), a2 = second(), n1 = f.l1 + 1, n2 = f.l2 + 1
			const y = unpackDecimal(operand(a2, n2))
			if (op === 0xf8) { checkAddress(c, a1, n1, 1, false); storeDecimal(c, a1, n1, y); return }
			const xBytes = operand(a1, n1), x = unpackDecimal(xBytes)
			if (op === 0xf9) { setCC(c, x === y ? 0 : x < y ? 1 : 2); return }
			if (op === 0xfa || op === 0xfb) { storeDecimal(c, a1, n1, op === 0xfa ? x + y : x - y); return }
			if (n2 > 8 || n2 >= n1) interrupt(SPECIFICATION, 'second operand must be shorter than the first and at most 8 bytes')
			const negative = !isPlus(xBytes[n1 - 1] & 15) !== !isPlus(operand(a2 + n2 - 1, 1)[0] & 15)
			if (op === 0xfc) {
				for (let i = 0; i < n2; i++) if (xBytes[i]) interrupt(DATA, 'multiplicand needs as many leading zero bytes as the multiplier is long')
				store(a1, packDecimal(x * y, n1, negative).bytes)
				return
			}
			if (y === 0n) interrupt(DECIMAL_DIVIDE, 'divisor is zero')
			const quotient = x / y, remainder = x % y, quotientBytes = n1 - n2
			if (truncateDecimal(quotient, quotientBytes) !== quotient) interrupt(DECIMAL_DIVIDE, 'quotient too long')
			store(a1, [...packDecimal(quotient, quotientBytes, negative).bytes, ...packDecimal(remainder, n2, !isPlus(xBytes[n1 - 1] & 15)).bytes])
			return
		}
	}
	// Floating point: short forms keep the low half of the register.
	floatRegister(r1)
	const memory = op >= 0x40, registerOperand = !memory
	if (registerOperand) floatRegister(r2)
	const shortSource = () => memory ? hfp.fromShort(word(rx())) : shortOf(c, r2)
	const longSource = () => memory ? hfp.fromLong(long(rx())) : longOf(c, r2)
	const s370 = !!(model.features & S370)
	switch (op) {
		case 0x20: case 0x21: case 0x22: case 0x23: { const v = longOf(c, r2); floatResult(r1, op === 0x22 ? v : { ...v, sign: op === 0x20 ? 0 : op === 0x21 ? 1 : v.sign ^ 1 }, true); return }
		case 0x30: case 0x31: case 0x32: case 0x33: { const v = shortOf(c, r2); floatResult(r1, op === 0x32 ? v : { ...v, sign: op === 0x30 ? 0 : op === 0x31 ? 1 : v.sign ^ 1 }, false); return }
		case 0x24: setLong(c, r1, hfp.halve(longOf(c, r2), hfp.LONG, s370, mask)); return
		case 0x34: setShort(c, r1, hfp.halve(shortOf(c, r2), hfp.SHORT, s370, mask)); return
		case 0x25: extendedRegister(r2); setLong(c, r1, hfp.round(extendedOf(c, r2), hfp.EXTENDED, hfp.LONG)); return
		case 0x35: setShort(c, r1, hfp.round(longOf(c, r2), hfp.LONG, hfp.SHORT)); return
		case 0x26: extendedRegister(r1); extendedRegister(r2); setExtended(c, r1, hfp.multiply(extendedOf(c, r1), extendedOf(c, r2), hfp.EXTENDED, hfp.EXTENDED, mask)); return
		case 0x27: case 0x67: extendedRegister(r1); setExtended(c, r1, hfp.multiply(longOf(c, r1), longSource(), hfp.LONG, hfp.EXTENDED, mask)); return
		case 0x36: case 0x37: {
			extendedRegister(r1); extendedRegister(r2)
			const b = extendedOf(c, r2), result = hfp.add(extendedOf(c, r1), op === 0x37 ? hfp.negate(b) : b, hfp.EXTENDED, true, mask)
			setExtended(c, r1, result); setCC(c, hfp.resultCode(result))
			return
		}
		case 0x28: case 0x68: setLong(c, r1, longSource()); return
		case 0x38: case 0x78: setShort(c, r1, shortSource()); return
		case 0x60: { const address = rx(); checkAddress(c, address, 8, 8, aligned); c.writeWide(address, longBits(c, r1)); return }
		case 0x70: storeWord(rx(), c.r[FPR + r1]); return
		case 0x29: case 0x69: setCC(c, hfp.compare(longOf(c, r1), longSource(), hfp.LONG)); return
		case 0x39: case 0x79: setCC(c, hfp.compare(shortOf(c, r1), shortSource(), hfp.SHORT)); return
		case 0x2a: case 0x2b: case 0x2e: case 0x2f: case 0x6a: case 0x6b: case 0x6e: case 0x6f: {
			const b = longSource(), subtract = (op & 1) === 1
			floatResult(r1, hfp.add(longOf(c, r1), subtract ? hfp.negate(b) : b, hfp.LONG, (op & 0xf) < 0xe, mask), true)
			return
		}
		case 0x3a: case 0x3b: case 0x3e: case 0x3f: case 0x7a: case 0x7b: case 0x7e: case 0x7f: {
			const b = shortSource(), subtract = (op & 1) === 1
			floatResult(r1, hfp.add(shortOf(c, r1), subtract ? hfp.negate(b) : b, hfp.SHORT, (op & 0xf) < 0xe, mask), false)
			return
		}
		case 0x2c: case 0x6c: setLong(c, r1, hfp.multiply(longOf(c, r1), longSource(), hfp.LONG, hfp.LONG, mask)); return
		case 0x3c: case 0x7c: {
			const product = hfp.multiply(shortOf(c, r1), shortSource(), hfp.SHORT, s370 ? hfp.LONG : hfp.SHORT, mask)
			if (s370) setLong(c, r1, product)
			else setShort(c, r1, product)
			return
		}
		case 0x2d: case 0x6d: setLong(c, r1, hfp.divide(longOf(c, r1), longSource(), hfp.LONG, mask)); return
		case 0x3d: case 0x7d: setShort(c, r1, hfp.divide(shortOf(c, r1), shortSource(), hfp.SHORT, mask)); return
	}
	interrupt(OPERATION)
}

/* ---------------------------------------------------------------- decode */

const hex = (value: number) => `X'${value.toString(16).toUpperCase().padStart(2, '0')}'`
const storage = (d: number, x: number, b: number) => x && b ? `${d}(${x},${b})` : x ? `${d}(${x})` : b ? `${d}(,${b})` : `${d}`
const lengthStorage = (d: number, l: number, b: number) => `${d}(${l}${b ? `,${b}` : ''})`

const writesR1 = new Set([0x06, 0x10, 0x11, 0x12, 0x13, 0x14, 0x16, 0x17, 0x18, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x41, 0x43, 0x46, 0x48, 0x4a, 0x4b, 0x4c, 0x4f,
	0x54, 0x56, 0x57, 0x58, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f, 0x86, 0x87, 0x98, 0xbf])
const setsCC = new Set([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x19, 0x1a, 0x1b, 0x1e, 0x1f, 0x49, 0x4a, 0x4b, 0x54, 0x55, 0x56, 0x57, 0x59, 0x5a, 0x5b, 0x5e, 0x5f,
	0x8a, 0x8b, 0x8e, 0x8f, 0x91, 0x93, 0x94, 0x95, 0x96, 0x97, 0xd4, 0xd5, 0xd6, 0xd7, 0xdd, 0xde, 0xdf])
const loads = new Set([0x43, 0x48, 0x58, 0x98, 0x68, 0x78, 0xbf])
const stores = new Set([0x40, 0x42, 0x50, 0x90, 0x60, 0x70, 0x4e, 0xbe, 0x92, 0x93, 0x94, 0x96, 0x97, 0xd1, 0xd2, 0xd3, 0xd4, 0xd6, 0xd7, 0xdc, 0xde, 0xdf, 0xf0, 0xf1, 0xf2, 0xf3, 0xf8, 0xfa, 0xfb, 0xfc, 0xfd])

/** Decode at `offset` of `bytes`; `ilc` overrides the length code an EX target links with. */
export function decodeInstruction(bytes: ArrayLike<number>, offset: number, model: Model, ilc?: number): CpuInstruction {
	const op = bytes[offset], size = lengthOf(op)
	const b = (i: number) => bytes[offset + i] ?? 0
	const f: Fields = { op, size, r1: b(1) >> 4, r2: b(1) & 15, x2: b(1) & 15, i2: b(1), l1: b(1), l2: 0, b1: 0, d1: 0, b2: 0, d2: 0 }
	const entry = byCode[op]
	const raw = Array.from({ length: size }, (_, i) => b(i).toString(16).toUpperCase().padStart(2, '0')).join('')
	if (!entry || !hasFeatures(model, entry.requires)) {
		const reason = entry ? `${entry.name} is not installed on this model` : 'undefined opcode'
		return { size, text: `DC X'${raw}'`, kind: 'system', execute: () => interrupt(OPERATION, reason) }
	}
	if (size === 4) { f.b2 = b(2) >> 4; f.d2 = (b(2) & 15) << 8 | b(3); f.b1 = f.b2; f.d1 = f.d2 }
	if (size === 6) {
		f.b1 = b(2) >> 4; f.d1 = (b(2) & 15) << 8 | b(3); f.b2 = b(4) >> 4; f.d2 = (b(4) & 15) << 8 | b(5)
		if (entry.shape !== SSL) { f.l1 = b(1) >> 4; f.l2 = b(1) & 15 }
	}
	const reads: string[] = [], writes: string[] = []
	const gpr = (...indices: number[]) => { for (const i of indices) if (i) reads.push(`r${i}`) }
	let text: string, kind: CpuInstruction['kind'] = loads.has(op) ? 'load' : stores.has(op) ? 'store' : 'alu', call = false
	switch (entry.shape) {
		case RR1: text = `${f.r1}`; gpr(f.r1); writes.push('cc', 'pm'); break
		case RRI: text = `${f.i2}`; kind = 'system'; break
		case RR: text = `${f.r1},${f.r2}`; if (op < 0x20 || op > 0x3f) gpr(f.r1, f.r2); break
		case RX: text = `${f.r1},${storage(f.d2, f.x2, f.b2)}`; gpr(f.x2, f.b2); break
		case RS: text = `${f.r1},${f.x2},${storage(f.d2, 0, f.b2)}`; gpr(f.b2); break
		case RSH: text = `${f.r1},${storage(f.d2, 0, f.b2)}`; gpr(f.r1, f.b2); writes.push(`r${f.r1}`); break
		case SI: text = `${storage(f.d1, 0, f.b1)},${hex(f.i2)}`; gpr(f.b1); break
		case SI1: text = storage(f.d1, 0, f.b1); gpr(f.b1); break
		case SSL: text = `${lengthStorage(f.d1, f.l1 + 1, f.b1)},${storage(f.d2, 0, f.b2)}`; gpr(f.b1, f.b2); break
		case SSLL: text = `${lengthStorage(f.d1, f.l1 + 1, f.b1)},${lengthStorage(f.d2, f.l2 + 1, f.b2)}`; gpr(f.b1, f.b2); break
		default: text = `${lengthStorage(f.d1, f.l1 + 1, f.b1)},${storage(f.d2, 0, f.b2)},${f.l2}`; gpr(f.b1, f.b2)
	}
	if (op === 0x05 || op === 0x45) { kind = op === 0x45 || f.r2 ? 'call' : 'alu'; call = kind === 'call'; writes.push(`r${f.r1}`) }
	else if (op === 0x07) kind = f.r1 === 15 ? 'return' : 'branch'
	else if (op === 0x47 || op === 0x06 || op === 0x46 || op === 0x86 || op === 0x87) kind = op === 0x06 && !f.r2 ? 'alu' : 'branch'
	else if (op === 0x44) kind = 'system'
	if (op === 0x07 || op === 0x47) reads.push('cc')
	if (writesR1.has(op)) writes.push(`r${f.r1}`)
	if (op === 0x1c || op === 0x1d || op === 0x5c || op === 0x5d) writes.push(`r${f.r1 + 1 & 15}`)
	if (setsCC.has(op)) writes.push('cc')
	const link = ilc ?? size >> 1
	return { size, text: `${entry.name} ${text}`, kind, call, reads, writes, execute: c => execute(c, f, model, link) }
}
