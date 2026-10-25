import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'
import * as dec from './decFloat'

/** Native register columns: R0-R5, SP, PSW, then the FP11 status and six 64-bit accumulators as word pairs. */
export const SP = 6, PSW = 7, FPS = 8, FEC = 9, FEA = 10, AC = 11
export const N = 8, Z = 4, V = 2, C = 1, T = 0o20
export const FER = 0o100000, FID = 0o40000, FIUV = 0o4000, FIU = 0o2000, FIV = 0o1000, FIC = 0o400, FD = 0o200, FL = 0o100, FT = 0o40
export const FPS_WRITABLE = 0o147757
export const IO_PAGE = 0o160000
export const RCSR = 0o177560, RBUF = 0o177562, XCSR = 0o177564, XBUF = 0o177566, SWITCHES = 0o177570, PSW_ADDRESS = 0o177776
/** Trap vectors. */
export const BUS_ERROR = 0o4, RESERVED = 0o10, BREAKPOINT = 0o14, IOT_VECTOR = 0o20, EMT_VECTOR = 0o30, TRAP_VECTOR = 0o34, FP_VECTOR = 0o244

export type Model = 'pdp1120' | 'pdp1140' | 'pdp1145' | 'lsi1123'
export type FloatOption = 'none' | 'fis' | 'fp11'

/** What a processor implements beyond the PDP-11/20 base set. */
export interface Features {
	/** SOB, XOR, SXT, MARK and RTT, which the 11/40 added. */
	extended: boolean
	/** MUL, DIV, ASH and ASHC. */
	eis: boolean
	/** The KE11-F floating instruction set: FADD, FSUB, FMUL and FDIV. */
	fis: boolean
	/** The FP11 floating-point processor. */
	fp11: boolean
	spl: boolean
	/** MFPS and MTPS, which only LSI-11 processors have. */
	mxps: boolean
	name: string
}

export const MODEL_NAMES: Record<Model, string> = { 'pdp1120': 'PDP-11/20', 'pdp1140': 'PDP-11/40', 'pdp1145': 'PDP-11/45 and 11/70', 'lsi1123': 'LSI-11/23' }

export function featuresOf(model: Model, float: FloatOption): Features {
	const later = model !== 'pdp1120'
	return { extended: later, eis: later, fis: model === 'pdp1140' && float === 'fis', fp11: (model === 'pdp1145' || model === 'lsi1123') && float === 'fp11', spl: model === 'pdp1145', mxps: model === 'lsi1123', name: MODEL_NAMES[model] }
}

type Requirement = 'extended' | 'eis' | 'fis' | 'fp11' | 'spl' | 'mxps'
const REQUIREMENT_TEXT: Record<Requirement, string> = {
	extended: 'the PDP-11/40, 11/45 or LSI-11/23', eis: 'the EIS (PDP-11/40, 11/45 or LSI-11/23)', fis: 'the KE11-F FIS option on a PDP-11/40',
	fp11: 'the FP11 floating-point processor (PDP-11/45 or LSI-11/23 with FP11)', spl: 'the PDP-11/45', mxps: 'the LSI-11/23',
}

/** Operand shapes, which say how many operands there are and what mode 0 names. */
const enum Form { Double, Single, Branch, None, Jsr, Rts, RegisterSource, RegisterDestination, Sob, Trap, Mark, Spl, Fis, FloatSourceAc, AcFloatDestination, FloatDestination, SourceAc, AcDestination, Source, Destination }

interface Spec { opcode: number, form: Form, byte?: boolean, needs?: Requirement }
const spec = (opcode: number, form: Form, extra: Partial<Spec> = {}): Spec => ({ opcode, form, ...extra })

const table: Record<string, Spec> = {
	mov: spec(0o010000, Form.Double), cmp: spec(0o020000, Form.Double), bit: spec(0o030000, Form.Double), bic: spec(0o040000, Form.Double), bis: spec(0o050000, Form.Double), add: spec(0o060000, Form.Double),
	movb: spec(0o110000, Form.Double, { byte: true }), cmpb: spec(0o120000, Form.Double, { byte: true }), bitb: spec(0o130000, Form.Double, { byte: true }), bicb: spec(0o140000, Form.Double, { byte: true }), bisb: spec(0o150000, Form.Double, { byte: true }), sub: spec(0o160000, Form.Double),
	jmp: spec(0o000100, Form.Single), swab: spec(0o000300, Form.Single),
	clr: spec(0o005000, Form.Single), com: spec(0o005100, Form.Single), inc: spec(0o005200, Form.Single), dec: spec(0o005300, Form.Single), neg: spec(0o005400, Form.Single), adc: spec(0o005500, Form.Single), sbc: spec(0o005600, Form.Single), tst: spec(0o005700, Form.Single),
	ror: spec(0o006000, Form.Single), rol: spec(0o006100, Form.Single), asr: spec(0o006200, Form.Single), asl: spec(0o006300, Form.Single), sxt: spec(0o006700, Form.Single, { needs: 'extended' }),
	clrb: spec(0o105000, Form.Single, { byte: true }), comb: spec(0o105100, Form.Single, { byte: true }), incb: spec(0o105200, Form.Single, { byte: true }), decb: spec(0o105300, Form.Single, { byte: true }), negb: spec(0o105400, Form.Single, { byte: true }), adcb: spec(0o105500, Form.Single, { byte: true }), sbcb: spec(0o105600, Form.Single, { byte: true }), tstb: spec(0o105700, Form.Single, { byte: true }),
	rorb: spec(0o106000, Form.Single, { byte: true }), rolb: spec(0o106100, Form.Single, { byte: true }), asrb: spec(0o106200, Form.Single, { byte: true }), aslb: spec(0o106300, Form.Single, { byte: true }),
	mtps: spec(0o106400, Form.Single, { byte: true, needs: 'mxps' }), mfps: spec(0o106700, Form.Single, { byte: true, needs: 'mxps' }),
	br: spec(0o000400, Form.Branch), bne: spec(0o001000, Form.Branch), beq: spec(0o001400, Form.Branch), bge: spec(0o002000, Form.Branch), blt: spec(0o002400, Form.Branch), bgt: spec(0o003000, Form.Branch), ble: spec(0o003400, Form.Branch),
	bpl: spec(0o100000, Form.Branch), bmi: spec(0o100400, Form.Branch), bhi: spec(0o101000, Form.Branch), blos: spec(0o101400, Form.Branch), bvc: spec(0o102000, Form.Branch), bvs: spec(0o102400, Form.Branch),
	bcc: spec(0o103000, Form.Branch), bhis: spec(0o103000, Form.Branch), bcs: spec(0o103400, Form.Branch), blo: spec(0o103400, Form.Branch),
	jsr: spec(0o004000, Form.Jsr), rts: spec(0o000200, Form.Rts),
	mul: spec(0o070000, Form.RegisterSource, { needs: 'eis' }), div: spec(0o071000, Form.RegisterSource, { needs: 'eis' }), ash: spec(0o072000, Form.RegisterSource, { needs: 'eis' }), ashc: spec(0o073000, Form.RegisterSource, { needs: 'eis' }),
	xor: spec(0o074000, Form.RegisterDestination, { needs: 'extended' }), sob: spec(0o077000, Form.Sob, { needs: 'extended' }),
	fadd: spec(0o075000, Form.Fis, { needs: 'fis' }), fsub: spec(0o075010, Form.Fis, { needs: 'fis' }), fmul: spec(0o075020, Form.Fis, { needs: 'fis' }), fdiv: spec(0o075030, Form.Fis, { needs: 'fis' }),
	emt: spec(0o104000, Form.Trap), trap: spec(0o104400, Form.Trap), mark: spec(0o006400, Form.Mark, { needs: 'extended' }), spl: spec(0o000230, Form.Spl, { needs: 'spl' }),
	halt: spec(0, Form.None), wait: spec(1, Form.None), rti: spec(2, Form.None), bpt: spec(3, Form.None), iot: spec(4, Form.None), reset: spec(5, Form.None), rtt: spec(6, Form.None, { needs: 'extended' }),
	nop: spec(0o240, Form.None), clc: spec(0o241, Form.None), clv: spec(0o242, Form.None), clz: spec(0o244, Form.None), cln: spec(0o250, Form.None), ccc: spec(0o257, Form.None),
	sec: spec(0o261, Form.None), sev: spec(0o262, Form.None), sez: spec(0o264, Form.None), sen: spec(0o270, Form.None), scc: spec(0o277, Form.None),
	cfcc: spec(0o170000, Form.None, { needs: 'fp11' }), setf: spec(0o170001, Form.None, { needs: 'fp11' }), seti: spec(0o170002, Form.None, { needs: 'fp11' }), setd: spec(0o170011, Form.None, { needs: 'fp11' }), setl: spec(0o170012, Form.None, { needs: 'fp11' }),
	ldfps: spec(0o170100, Form.Source, { needs: 'fp11' }), stfps: spec(0o170200, Form.Destination, { needs: 'fp11' }), stst: spec(0o170300, Form.Destination, { needs: 'fp11' }),
	clrf: spec(0o170400, Form.FloatDestination, { needs: 'fp11' }), clrd: spec(0o170400, Form.FloatDestination, { needs: 'fp11' }),
	tstf: spec(0o170500, Form.FloatDestination, { needs: 'fp11' }), tstd: spec(0o170500, Form.FloatDestination, { needs: 'fp11' }),
	absf: spec(0o170600, Form.FloatDestination, { needs: 'fp11' }), absd: spec(0o170600, Form.FloatDestination, { needs: 'fp11' }),
	negf: spec(0o170700, Form.FloatDestination, { needs: 'fp11' }), negd: spec(0o170700, Form.FloatDestination, { needs: 'fp11' }),
	mulf: spec(0o171000, Form.FloatSourceAc, { needs: 'fp11' }), muld: spec(0o171000, Form.FloatSourceAc, { needs: 'fp11' }),
	modf: spec(0o171400, Form.FloatSourceAc, { needs: 'fp11' }), modd: spec(0o171400, Form.FloatSourceAc, { needs: 'fp11' }),
	addf: spec(0o172000, Form.FloatSourceAc, { needs: 'fp11' }), addd: spec(0o172000, Form.FloatSourceAc, { needs: 'fp11' }),
	ldf: spec(0o172400, Form.FloatSourceAc, { needs: 'fp11' }), ldd: spec(0o172400, Form.FloatSourceAc, { needs: 'fp11' }),
	subf: spec(0o173000, Form.FloatSourceAc, { needs: 'fp11' }), subd: spec(0o173000, Form.FloatSourceAc, { needs: 'fp11' }),
	cmpf: spec(0o173400, Form.FloatSourceAc, { needs: 'fp11' }), cmpd: spec(0o173400, Form.FloatSourceAc, { needs: 'fp11' }),
	stf: spec(0o174000, Form.AcFloatDestination, { needs: 'fp11' }), std: spec(0o174000, Form.AcFloatDestination, { needs: 'fp11' }),
	divf: spec(0o174400, Form.FloatSourceAc, { needs: 'fp11' }), divd: spec(0o174400, Form.FloatSourceAc, { needs: 'fp11' }),
	stexp: spec(0o175000, Form.AcDestination, { needs: 'fp11' }),
	stcfi: spec(0o175400, Form.AcDestination, { needs: 'fp11' }), stcfl: spec(0o175400, Form.AcDestination, { needs: 'fp11' }), stcdi: spec(0o175400, Form.AcDestination, { needs: 'fp11' }), stcdl: spec(0o175400, Form.AcDestination, { needs: 'fp11' }),
	stcfd: spec(0o176000, Form.AcFloatDestination, { needs: 'fp11' }), stcdf: spec(0o176000, Form.AcFloatDestination, { needs: 'fp11' }),
	ldexp: spec(0o176400, Form.SourceAc, { needs: 'fp11' }),
	ldcif: spec(0o177000, Form.SourceAc, { needs: 'fp11' }), ldcid: spec(0o177000, Form.SourceAc, { needs: 'fp11' }), ldclf: spec(0o177000, Form.SourceAc, { needs: 'fp11' }), ldcld: spec(0o177000, Form.SourceAc, { needs: 'fp11' }),
	ldcdf: spec(0o177400, Form.FloatSourceAc, { needs: 'fp11' }), ldcfd: spec(0o177400, Form.FloatSourceAc, { needs: 'fp11' }),
}

export const allInstructions = Object.keys(table)
export const instructionsFor = (features: Features) => allInstructions.filter(name => !table[name].needs || features[table[name].needs!])

/* ------------------------------------------------------------- assembling */

const GENERAL = /^(?:r([0-7])|%([0-7])|(sp)|(pc))$/i
const FLOATING = /^(?:ac([0-5])|%([0-5]))$/i

function generalRegister(text: string): number | null {
	const m = GENERAL.exec(text.trim())
	return m ? m[3] ? 6 : m[4] ? 7 : Number(m[1] ?? m[2]) : null
}
function floatRegister(text: string): number | null {
	const m = FLOATING.exec(text.trim())
	return m ? Number(m[1] ?? m[2]) : null
}

/** A parsed operand: its mode and register, and the text of an extension word. */
interface Operand { mode: number, reg: number, ext?: string, relative?: boolean }

function parseOperand(text: string, floating: boolean): Operand {
	const t = text.trim()
	const register = (inner: string) => {
		const r = generalRegister(inner)
		if (r === null) throw new Error(`Expected R0-R5, SP or PC, got ${inner}`)
		return r
	}
	if (!t) throw new Error('Missing operand')
	const direct = floating ? floatRegister(t) : generalRegister(t)
	if (direct !== null) return { mode: 0, reg: direct }
	if (floating && generalRegister(t) !== null) throw new Error(`A floating operand in mode 0 names AC0-AC5, not ${t}`)
	if (!floating && floatRegister(t) !== null && /^ac/i.test(t)) throw new Error(`${t} is a floating accumulator; this operand takes a general register`)
	const deferred = t.startsWith('@'), body = deferred ? t.slice(1).trim() : t
	if (body.startsWith('#')) {
		if (deferred) return { mode: 3, reg: 7, ext: body.slice(1).trim() }
		return { mode: 2, reg: 7, ext: body.slice(1).trim() }
	}
	let m = /^\(([^()]+)\)\+$/.exec(body)
	if (m) return { mode: deferred ? 3 : 2, reg: register(m[1]) }
	m = /^-\s*\(([^()]+)\)$/.exec(body)
	if (m && generalRegister(m[1]) !== null) return { mode: deferred ? 5 : 4, reg: register(m[1]) }
	m = /^\(([^()]+)\)$/.exec(body)
	if (m && generalRegister(m[1]) !== null) return deferred ? { mode: 7, reg: register(m[1]), ext: '0' } : { mode: 1, reg: register(m[1]) }
	if (deferred && generalRegister(body) !== null) return { mode: 1, reg: register(body) }
	m = /^(.+)\(([^()]+)\)$/.exec(body)
	if (m && generalRegister(m[2]) !== null) return { mode: deferred ? 7 : 6, reg: register(m[2]), ext: m[1].trim() }
	if (generalRegister(body) !== null || floatRegister(body) !== null && /^ac/i.test(body)) throw new Error(`Deferred register operands are written @Rn or (Rn), got ${t}`)
	return { mode: deferred ? 7 : 6, reg: 7, ext: body, relative: true }
}

const extensionWords = (o: Operand) => o.ext !== undefined ? 1 : 0

function lookup(mnemonic: string): Spec {
	const name = mnemonic.toLowerCase()
	if (!Object.prototype.hasOwnProperty.call(table, name)) throw new Error(`Unknown PDP-11 instruction ${mnemonic}`)
	return table[name]
}

function require(name: string, s: Spec, features: Features) {
	if (s.needs && !features[s.needs]) throw new Error(`${name.toUpperCase()} requires ${REQUIREMENT_TEXT[s.needs]}; the ${features.name} reserves it`)
}

/** Which operand positions hold an addressing-mode field, and whether mode 0 there names an accumulator. */
function operandsOf(s: Spec, ops: readonly string[]): { modes: Operand[], count: number } {
	const parse = (index: number, floating = false) => parseOperand(ops[index] ?? '', floating)
	switch (s.form) {
		case Form.Double: return { modes: [parse(0), parse(1)], count: 2 }
		case Form.Single: case Form.Source: case Form.Destination: return { modes: [parse(0)], count: 1 }
		case Form.Jsr: case Form.RegisterDestination: return { modes: [parse(1)], count: 2 }
		case Form.RegisterSource: return { modes: [parse(0)], count: 2 }
		case Form.FloatDestination: return { modes: [parse(0, true)], count: 1 }
		case Form.FloatSourceAc: return { modes: [parse(0, true)], count: 2 }
		case Form.SourceAc: return { modes: [parse(0)], count: 2 }
		case Form.AcFloatDestination: return { modes: [parse(1, true)], count: 2 }
		case Form.AcDestination: return { modes: [parse(1)], count: 2 }
		case Form.Branch: case Form.Rts: case Form.Fis: case Form.Mark: case Form.Spl: return { modes: [], count: 1 }
		case Form.Sob: return { modes: [], count: 2 }
		case Form.Trap: return { modes: [], count: ops.length ? 1 : 0 }
		case Form.None: return { modes: [], count: 0 }
	}
}

export function instructionSize(mnemonic: string, ops: readonly string[], features?: Features): number {
	const s = lookup(mnemonic)
	if (features) require(mnemonic, s, features)
	const { modes } = operandsOf(s, ops)
	return 2 + modes.reduce((total, o) => total + extensionWords(o) * 2, 0)
}

function integer(value: number, min: number, max: number, what: string): number {
	if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${what} must be ${min} through ${max}`)
	return value
}
const word = (value: number) => integer(value, -32768, 65535, 'A word value') & 0xffff

/** MACRO-11 reads an FP11 immediate as a one-word floating literal: the upper 16 bits of F, rounded. */
function floatLiteral(text: string, c: CpuEncodingContext): number {
	const literal = dec.parseDecimal(text, true)
	return literal ? oneWord(literal.raw) : word(c.value(text))
}

/** The upper word of a value, rounded half away from zero on the bits it drops. */
export function oneWord(raw: bigint): number {
	const value = dec.unpack(raw, true)
	if (!value.m) return 0
	const guard = value.m >> 47n & 1n
	return Number(dec.round({ negative: value.negative, m: (value.m >> 48n) + guard, e: value.e + 48 }, false).raw >> 48n)
}

function registerOperand(text: string | undefined, what = 'register'): number {
	const r = generalRegister(text ?? '')
	if (r === null) throw new Error(`Expected a ${what} R0-R5, SP or PC, got ${text ?? 'nothing'}`)
	return r
}
function acOperand(text: string | undefined): number {
	const r = floatRegister(text ?? '')
	if (r === null) throw new Error(`Expected an accumulator AC0-AC3, got ${text ?? 'nothing'}`)
	if (r > 3) throw new Error('AC4 and AC5 are reachable only as a floating source or destination; this field takes AC0-AC3')
	return r
}

export function encode(mnemonic: string, ops: readonly string[], c: CpuEncodingContext, features: Features): number[] {
	const name = mnemonic.toLowerCase(), s = lookup(name)
	require(name, s, features)
	const { modes, count } = operandsOf(s, ops)
	if (ops.length !== count && !(s.form === Form.Trap && ops.length <= 1)) throw new Error(`${name.toUpperCase()} takes ${count} operand${count === 1 ? '' : 's'}`)
	const extension: number[] = []
	const field = (o: Operand, floatImmediate = false) => {
		if (o.ext !== undefined) {
			const at = c.address + 2 + extension.length * 2
			extension.push(o.relative ? word(c.value(o.ext) - (at + 2) & 0xffff) : floatImmediate && o.mode === 2 && o.reg === 7 ? floatLiteral(o.ext, c) : word(c.value(o.ext)))
		}
		return o.mode << 3 | o.reg
	}
	const out = (opcode: number) => [opcode, ...extension].flatMap(w => [w & 255, w >>> 8 & 255])
	const jumpable = (o: Operand) => { if (o.mode === 0) throw new Error(`${name.toUpperCase()} cannot target a register (mode 0 traps as an illegal instruction)`); return o }
	switch (s.form) {
		case Form.Double: { const src = field(modes[0]), dst = field(modes[1]); return out(s.opcode | src << 6 | dst) }
		case Form.Single: return out(s.opcode | field(name === 'jmp' ? jumpable(modes[0]) : modes[0]))
		case Form.Jsr: return out(s.opcode | registerOperand(ops[0]) << 6 | field(jumpable(modes[0])))
		case Form.Rts: return out(s.opcode | registerOperand(ops[0]))
		case Form.RegisterSource: {
			const r = registerOperand(ops[1])
			if (name === 'div' && r & 1) throw new Error('DIV needs an even register: the dividend is the pair Rn, Rn+1')
			return out(s.opcode | r << 6 | field(modes[0]))
		}
		case Form.RegisterDestination: return out(s.opcode | registerOperand(ops[0]) << 6 | field(modes[0]))
		case Form.Fis: return out(s.opcode | registerOperand(ops[0]))
		case Form.Branch: {
			const delta = c.value(ops[0]) - (c.address + 2)
			if (delta & 1) throw new Error('Branch target must be word aligned')
			return out(s.opcode | integer(delta / 2, -128, 127, 'Branch offset (words)') & 255)
		}
		case Form.Sob: {
			const delta = c.address + 2 - c.value(ops[1])
			if (delta & 1) throw new Error('SOB target must be word aligned')
			return out(s.opcode | registerOperand(ops[0]) << 6 | integer(delta / 2, 0, 63, 'SOB backward offset (words)'))
		}
		case Form.Trap: return out(s.opcode | (ops.length ? integer(c.value(ops[0]), 0, 255, `${name.toUpperCase()} code`) : 0))
		case Form.Mark: return out(s.opcode | integer(c.value(ops[0]), 0, 63, 'MARK count'))
		case Form.Spl: return out(s.opcode | integer(c.value(ops[0]), 0, 7, 'SPL priority'))
		case Form.None: return out(s.opcode)
		case Form.Source: case Form.Destination: return out(s.opcode | field(modes[0]))
		case Form.FloatDestination: return out(s.opcode | field(modes[0]))
		case Form.FloatSourceAc: return out(s.opcode | acOperand(ops[1]) << 6 | field(modes[0], true))
		case Form.SourceAc: return out(s.opcode | acOperand(ops[1]) << 6 | field(modes[0]))
		case Form.AcFloatDestination: case Form.AcDestination: return out(s.opcode | acOperand(ops[0]) << 6 | field(modes[0]))
	}
}

/* ---------------------------------------------------------------- running */

/** A trap taken partway through an instruction, as the hardware does. */
export class Trap {
	constructor(readonly vector: number, readonly reason: string) {}
}

const sign16 = (v: number) => v << 16 >> 16
const sign8 = (v: number) => v << 24 >> 24
const octal = (v: number) => (v & 0xffff).toString(8)
const opcodeText = (v: number) => octal(v).padStart(6, '0')

/** Set while an instruction's store to the PSW must outlast its own condition codes. */
let pswStored = false

export function readRegister(c: CpuContext, r: number, pc: number): number { return r === 7 ? pc : c.r[r] }
function writeRegister(c: CpuContext, r: number, value: number) { if (r === 7) c.pc = value & 0xffff; else c.r[r] = value & 0xffff }

function readWord(c: CpuContext, a: number): number {
	a &= 0xffff
	if (a & 1) throw new Trap(BUS_ERROR, `Odd address ${octal(a)} on a word access`)
	if (a >= IO_PAGE) return ioRead(c, a)
	return c.read(a, 2)
}
function readByte(c: CpuContext, a: number): number {
	a &= 0xffff
	if (a >= IO_PAGE) return ioRead(c, a & ~1) >>> (a & 1) * 8 & 255
	return c.read(a, 1)
}
function writeWord(c: CpuContext, a: number, value: number) {
	a &= 0xffff
	if (a & 1) throw new Trap(BUS_ERROR, `Odd address ${octal(a)} on a word access`)
	if (a >= IO_PAGE) ioWrite(c, a, value & 0xffff, 2)
	else c.write(a, value & 0xffff, 2)
}
function writeByte(c: CpuContext, a: number, value: number) {
	a &= 0xffff
	if (a >= IO_PAGE) ioWrite(c, a, value & 255, 1)
	else c.write(a, value & 255, 1)
}

/** The console DL11 and the PSW are the only devices on this I/O page. */
function ioRead(c: CpuContext, a: number): number {
	switch (a) {
		case PSW_ADDRESS: return c.r[PSW]
		case XCSR: return 0o200
		case RCSR: case RBUF: case SWITCHES: return 0
	}
	throw new Trap(BUS_ERROR, `No device answers at ${octal(a)} (bus timeout)`)
}
function ioWrite(c: CpuContext, a: number, value: number, bytes: number) {
	const register = a & ~1
	switch (register) {
		case PSW_ADDRESS: if (bytes === 2 || !(a & 1)) { c.r[PSW] = value & 0xff; pswStored = true } return
		case XBUF: if (!(a & 1)) c.output(String.fromCharCode(value & 255)); return
		case XCSR: case RCSR: case RBUF: case SWITCHES: return
	}
	throw new Trap(BUS_ERROR, `No device answers at ${octal(a)} (bus timeout)`)
}

function push(c: CpuContext, value: number) { c.r[SP] = c.r[SP] - 2 & 0xffff; writeWord(c, c.r[SP], value) }
function pop(c: CpuContext): number { const value = readWord(c, c.r[SP]); c.r[SP] = c.r[SP] + 2 & 0xffff; return value }

/** Push PSW and PC and load the vector; an empty vector is a fault with nowhere to go. */
export function enterTrap(c: CpuContext, trap: Trap) {
	const pc = c.read(trap.vector, 2), psw = c.read(trap.vector + 2, 2)
	if (!pc && !psw) throw new Error(`${trap.reason}: trap to vector ${octal(trap.vector)}, which has no handler`)
	try {
		const oldPsw = c.r[PSW], oldPc = c.pc
		push(c, oldPsw); push(c, oldPc)
	} catch (error) {
		if (error instanceof Trap) throw new Error(`${trap.reason}, then ${error.reason} pushing the trap frame (double fault)`, { cause: error })
		throw error
	}
	c.r[PSW] = psw & 0xff
	c.call(pc & 0xfffe, c.pc)
}

/** A decoded addressing-mode field, with the PC value the processor sees while evaluating it. */
interface Field { mode: number, reg: number, ext: number, next: number }

function step(f: Field, width: number) { return width === 1 && f.reg >= 6 ? 2 : width }

/** The effective address, applying the mode's register side effects. */
function address(c: CpuContext, f: Field, width: number): number {
	const { mode, reg } = f
	if (reg === 7) switch (mode) {
		case 2: return f.next - 2
		case 3: return f.ext
		case 6: return f.ext + f.next & 0xffff
		case 7: return readWord(c, f.ext + f.next & 0xffff)
	}
	const value = readRegister(c, reg, f.next)
	switch (mode) {
		case 1: return value
		case 2: writeRegister(c, reg, value + step(f, width)); return value
		case 3: writeRegister(c, reg, value + 2); return readWord(c, value)
		case 4: { const a = value - step(f, width) & 0xffff; writeRegister(c, reg, a); return a }
		case 5: { const a = value - 2 & 0xffff; writeRegister(c, reg, a); return readWord(c, a) }
		case 6: return f.ext + value & 0xffff
		case 7: return readWord(c, f.ext + value & 0xffff)
	}
	throw new Error('Register mode has no address')
}

/** `address` under a name decode's own `address` does not shadow. */
const effective = (c: CpuContext, f: Field, width: number) => address(c, f, width)

/** An operand resolved once, so a read-modify-write touches its address once. */
interface Place { f: Field, at: number }
function place(c: CpuContext, f: Field, width: number): Place { return { f, at: f.mode === 0 ? -1 : address(c, f, width) } }
function load(c: CpuContext, p: Place, width: number): number {
	if (p.at < 0) { const v = readRegister(c, p.f.reg, p.f.next); return width === 1 ? v & 255 : v }
	return width === 1 ? readByte(c, p.at) : readWord(c, p.at)
}
function store(c: CpuContext, p: Place, value: number, width: number) {
	if (p.at < 0) writeRegister(c, p.f.reg, width === 1 ? readRegister(c, p.f.reg, p.f.next) & 0xff00 | value & 255 : value)
	else if (width === 1) writeByte(c, p.at, value)
	else writeWord(c, p.at, value)
}

function setFlags(c: CpuContext, n: boolean, z: boolean, v: boolean, carry: boolean) {
	if (pswStored) return
	c.r[PSW] = c.r[PSW] & ~15 | (n ? N : 0) | (z ? Z : 0) | (v ? V : 0) | (carry ? C : 0)
}
const carry = (c: CpuContext) => !!(c.r[PSW] & C)

function condition(c: CpuContext, opcode: number): boolean {
	const psw = c.r[PSW], n = !!(psw & N), z = !!(psw & Z), v = !!(psw & V), cf = !!(psw & C)
	switch (opcode & 0o177400) {
		case 0o000400: return true
		case 0o001000: return !z
		case 0o001400: return z
		case 0o002000: return n === v
		case 0o002400: return n !== v
		case 0o003000: return !z && n === v
		case 0o003400: return z || n !== v
		case 0o100000: return !n
		case 0o100400: return n
		case 0o101000: return !cf && !z
		case 0o101400: return cf || z
		case 0o102000: return !v
		case 0o102400: return v
		case 0o103000: return !cf
		case 0o103400: return cf
	}
	return false
}

/** THRAX monitor services, offered while the EMT vector is empty. */
function monitor(c: CpuContext, code: number) {
	switch (code) {
		case 1: c.output(String(sign16(c.r[0]))); return
		case 2: {
			let text = ''
			for (let a = c.r[0], n = 0; ; a = a + 1 & 0xffff, n++) {
				if (n > 0xffff) throw new Error('Unterminated monitor string')
				const byte = readByte(c, a)
				if (!byte) break
				text += String.fromCharCode(byte)
			}
			c.output(text); return
		}
		case 3: c.r[0] = c.inputInteger(16) & 0xffff; return
		case 4: c.output(String.fromCharCode(c.r[0] & 255)); return
	}
	throw new Error(`EMT ${octal(code)} is not a THRAX monitor service and the EMT vector at 30 is empty`)
}

/* ----------------------------------------------------------------- FP11 */

const acHigh = (n: number) => AC + n * 2
export function readAc(words: ArrayLike<number>, n: number): bigint { return BigInt(words[acHigh(n)] >>> 0) << 32n | BigInt(words[acHigh(n) + 1] >>> 0) }
export function writeAc(c: CpuContext, n: number, raw: bigint, double: boolean) {
	c.r[acHigh(n)] = Number(raw >> 32n & 0xffffffffn)
	if (double) c.r[acHigh(n) + 1] = Number(raw & 0xffffffffn)
}

function fpFault(c: CpuContext, code: number, reason: string): Trap {
	c.r[FPS] |= FER
	c.r[FEC] = code
	c.r[FEA] = c.instructionAddress
	return new Trap(FP_VECTOR, `Floating-point exception (FEC ${code}): ${reason}`)
}
function raise(c: CpuContext, code: number, reason: string) { if (!(c.r[FPS] & FID)) throw fpFault(c, code, reason); c.r[FEC] = code; c.r[FEA] = c.instructionAddress; c.r[FPS] |= FER }

function setFloatFlags(c: CpuContext, raw: bigint, overflow = false, conversion = false) {
	const zero = dec.exponentOf(raw) === 0
	c.r[FPS] = c.r[FPS] & ~15 | (dec.isNegative(raw) && !zero ? N : 0) | (zero ? Z : 0) | (overflow ? V : 0) | (conversion ? C : 0)
}

/** Where a floating operand lives: an accumulator, or memory (an immediate is the one word after the opcode). */
interface FloatPlace { ac: number, at: number, immediate: boolean }
function floatPlace(c: CpuContext, f: Field, double: boolean): FloatPlace {
	if (f.mode === 0) {
		if (f.reg > 5) throw fpFault(c, 2, `AC${f.reg} does not exist`)
		return { ac: f.reg, at: -1, immediate: false }
	}
	if (f.mode === 2 && f.reg === 7) return { ac: -1, at: f.next - 2, immediate: true }
	return { ac: -1, at: address(c, f, double ? 8 : 4), immediate: false }
}
function readFloat(c: CpuContext, p: FloatPlace, double: boolean): bigint {
	let raw: bigint
	if (p.ac >= 0) raw = readAc(c.r, p.ac) & (double ? -1n : 0xffffffff00000000n)
	else if (p.immediate) raw = BigInt(readWord(c, p.at)) << 48n
	else raw = dec.fromWords(Array.from({ length: double ? 4 : 2 }, (_, i) => readWord(c, p.at + i * 2)))
	if (dec.isUndefined(raw) && c.r[FPS] & FIUV) throw fpFault(c, 12, 'undefined variable (minus zero)')
	return raw
}
function writeFloat(c: CpuContext, p: FloatPlace, raw: bigint, double: boolean) {
	if (p.ac >= 0) writeAc(c, p.ac, raw, double)
	else dec.toWords(raw, double).slice(0, p.immediate ? 1 : 4).forEach((w, i) => writeWord(c, p.at + i * 2, w))
}
const loadFloat = (c: CpuContext, f: Field, double: boolean) => readFloat(c, floatPlace(c, f, double), double)
const storeFloat = (c: CpuContext, f: Field, raw: bigint, double: boolean) => writeFloat(c, floatPlace(c, f, double), raw, double)

/** Store a rounded result, then report what the rounding did. */
function result(c: CpuContext, rounded: dec.Rounded, write: (raw: bigint) => void) {
	write(rounded.raw)
	setFloatFlags(c, rounded.raw, rounded.overflow)
	if (rounded.overflow && c.r[FPS] & FIV) raise(c, 8, 'floating overflow')
	if (rounded.underflow && c.r[FPS] & FIU) raise(c, 10, 'floating underflow')
}

function integerOperand(c: CpuContext, f: Field, long: boolean): bigint {
	if (f.mode === 0) return BigInt(sign16(readRegister(c, f.reg, f.next))) << (long ? 16n : 0n)
	if (f.mode === 2 && f.reg === 7) return BigInt(sign16(readWord(c, f.next - 2))) << (long ? 16n : 0n)
	const a = address(c, f, long ? 4 : 2)
	return long ? BigInt((readWord(c, a) << 16 | readWord(c, a + 2)) | 0) : BigInt(sign16(readWord(c, a)))
}

function executeFloat(c: CpuContext, opcode: number, f: Field) {
	const fps = c.r[FPS], double = !!(fps & FD), truncate = !!(fps & FT), ac = opcode >>> 6 & 3
	const accumulator = () => readAc(c.r, ac) & (double ? -1n : 0xffffffff00000000n)
	const toAc = (raw: bigint) => writeAc(c, ac, raw, double)
	const copyFlags = () => { c.r[PSW] = c.r[PSW] & ~15 | c.r[FPS] & 15 }
	switch (opcode & 0o177700) {
		case 0o170000:
			switch (opcode) {
				case 0o170000: c.r[PSW] = c.r[PSW] & ~15 | fps & 15; return
				case 0o170001: c.r[FPS] = fps & ~FD; return
				case 0o170002: c.r[FPS] = fps & ~FL; return
				case 0o170011: c.r[FPS] = fps | FD; return
				case 0o170012: c.r[FPS] = fps | FL; return
			}
			throw fpFault(c, 2, `opcode ${octal(opcode)} is not an FP11 instruction`)
		case 0o170100: c.r[FPS] = load(c, place(c, f, 2), 2) & FPS_WRITABLE; return
		case 0o170200: store(c, place(c, f, 2), c.r[FPS], 2); return
		case 0o170300: {
			const p = place(c, f, 4)
			if (p.at < 0) store(c, p, c.r[FEC], 2)
			else { writeWord(c, p.at, c.r[FEC]); writeWord(c, p.at + 2, c.r[FEA]) }
			return
		}
		case 0o170400: storeFloat(c, f, 0n, double); setFloatFlags(c, 0n); return
		case 0o170500: setFloatFlags(c, loadFloat(c, f, double)); return
		case 0o170600: case 0o170700: {
			const p = floatPlace(c, f, double), raw = readFloat(c, p, double)
			const value = dec.exponentOf(raw) === 0 ? 0n : (opcode & 0o177700) === 0o170600 ? raw & ~(1n << 63n) : raw ^ 1n << 63n
			writeFloat(c, p, value, double)
			setFloatFlags(c, value)
			return
		}
	}
	switch (opcode & 0o177400) {
		case 0o171000: result(c, dec.round(dec.multiply(dec.unpack(accumulator(), double), dec.unpack(loadFloat(c, f, double), double)), double, truncate), toAc); return
		case 0o171400: {
			const product = dec.multiply(dec.unpack(accumulator(), double), dec.unpack(loadFloat(c, f, double), double))
			const [whole, fraction] = dec.splitInteger(product)
			const rounded = dec.round(fraction, double, truncate)
			if (!(ac & 1)) writeAc(c, ac | 1, dec.round(whole, double, true).raw, double)
			result(c, rounded, toAc)
			return
		}
		case 0o172000: result(c, dec.round(dec.add(dec.unpack(accumulator(), double), dec.unpack(loadFloat(c, f, double), double)), double, truncate), toAc); return
		case 0o172400: { const raw = loadFloat(c, f, double), clean = dec.exponentOf(raw) ? raw : 0n; toAc(clean); setFloatFlags(c, clean); return }
		case 0o173000: result(c, dec.round(dec.add(dec.unpack(accumulator(), double), dec.negate(dec.unpack(loadFloat(c, f, double), double))), double, truncate), toAc); return
		case 0o173400: {
			const order = dec.compare(dec.unpack(loadFloat(c, f, double), double), dec.unpack(accumulator(), double))
			c.r[FPS] = c.r[FPS] & ~15 | (order < 0 ? N : 0) | (order === 0 ? Z : 0)
			return
		}
		case 0o174000: storeFloat(c, f, accumulator(), double); return
		case 0o174400: {
			const divisor = dec.unpack(loadFloat(c, f, double), double)
			if (!divisor.m) { raise(c, 4, 'division by zero'); return }
			result(c, dec.round(dec.divide(dec.unpack(accumulator(), double), divisor), double, truncate), toAc)
			return
		}
		case 0o175000: {
			const exponent = dec.exponentOf(accumulator()), value = exponent ? exponent - 128 : 0
			store(c, place(c, f, 2), value, 2)
			c.r[FPS] = c.r[FPS] & ~15 | (value < 0 ? N : 0) | (value === 0 ? Z : 0)
			copyFlags()
			return
		}
		case 0o175400: {
			const long = !!(fps & FL), integral = dec.toInteger(dec.unpack(accumulator(), double))
			const limit = long ? 1n << 31n : 1n << 15n, fits = integral >= -limit && integral < limit, value = fits ? integral : 0n
			const p = place(c, f, long ? 4 : 2), bits = Number(BigInt.asUintN(32, value))
			if (p.at < 0 || !long) store(c, p, long ? bits >>> 16 : bits & 0xffff, 2)
			else { writeWord(c, p.at, bits >>> 16); writeWord(c, p.at + 2, bits & 0xffff) }
			c.r[FPS] = c.r[FPS] & ~15 | (value < 0n ? N : 0) | (value === 0n ? Z : 0) | (fits ? 0 : C)
			copyFlags()
			if (!fits && fps & FIC) raise(c, 6, 'integer conversion overflow')
			return
		}
		case 0o176000: {
			const other = !double, rounded = dec.round(dec.unpack(accumulator(), double), other, truncate)
			storeFloat(c, f, rounded.raw, other)
			setFloatFlags(c, rounded.raw, rounded.overflow)
			if (rounded.overflow && fps & FIV) raise(c, 8, 'floating overflow')
			return
		}
		case 0o176400: {
			const exponent = sign16(load(c, place(c, f, 2), 2)) + 128, current = accumulator()
			if (!dec.exponentOf(current)) { toAc(0n); setFloatFlags(c, 0n); return }
			const raw = exponent < 1 ? 0n : current & ~(255n << 55n) | BigInt(exponent & 255) << 55n
			result(c, { raw, overflow: exponent > 255, underflow: exponent < 1 }, toAc)
			return
		}
		case 0o177000: result(c, dec.round(dec.fromInteger(integerOperand(c, f, !!(fps & FL))), double, truncate), toAc); return
		case 0o177400: {
			const raw = loadFloat(c, f, !double)
			result(c, dec.round(dec.unpack(raw, !double), double, truncate), toAc)
			return
		}
	}
	throw fpFault(c, 2, `opcode ${octal(opcode)} is not an FP11 instruction`)
}

/** FIS operands are F values on a stack: B at (R)+4 becomes B op A, with A at (R). */
function executeFis(c: CpuContext, opcode: number) {
	const r = opcode & 7, base = readRegister(c, r, c.pc)
	const read = (a: number) => dec.fromWords([readWord(c, a), readWord(c, a + 2)])
	const a = dec.unpack(read(base), false), b = dec.unpack(read(base + 4), false)
	const fault = (n: boolean, carryFlag: boolean, reason: string) => { setFlags(c, n, false, true, carryFlag); throw new Trap(FP_VECTOR, `FIS ${reason}`) }
	let value: dec.Exact
	switch (opcode & 0o70) {
		case 0o00: value = dec.add(b, a); break
		case 0o10: value = dec.add(b, dec.negate(a)); break
		case 0o20: value = dec.multiply(b, a); break
		default: if (!a.m) fault(true, true, 'division by zero'); value = dec.divide(b, a)
	}
	const rounded = dec.round(value, false)
	if (rounded.overflow) fault(false, false, 'floating overflow')
	if (rounded.underflow) fault(true, false, 'floating underflow')
	dec.toWords(rounded.raw, false).forEach((w, i) => writeWord(c, base + 4 + i * 2, w))
	writeRegister(c, r, base + 4)
	setFlags(c, dec.isNegative(rounded.raw) && dec.exponentOf(rounded.raw) > 0, dec.exponentOf(rounded.raw) === 0, false, false)
}

/* --------------------------------------------------------------- decoding */

const REGISTER_NAMES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'SP', 'PC']
const REGISTER_IDS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'sp', 'pc']
const byOpcode = new Map<number, string>()
for (const [name, s] of Object.entries(table)) {
	// The first spelling of a shared opcode is the one disassembly shows.
	const key = s.opcode
	if (!byOpcode.has(key) && !['bhis', 'blo'].includes(name)) byOpcode.set(key, name)
}

function fieldText(f: Field, floating: boolean): string {
	const r = REGISTER_NAMES[f.reg]
	if (f.reg === 7) switch (f.mode) {
		case 2: return `#${octal(f.ext)}`
		case 3: return `@#${octal(f.ext)}`
		case 6: return octal(f.ext + f.next)
		case 7: return `@${octal(f.ext + f.next)}`
	}
	switch (f.mode) {
		case 0: return floating ? `AC${f.reg}` : r
		case 1: return `(${r})`
		case 2: return `(${r})+`
		case 3: return `@(${r})+`
		case 4: return `-(${r})`
		case 5: return `@-(${r})`
		case 6: return `${sign16(f.ext) < 0 ? `-${octal(-sign16(f.ext))}` : octal(f.ext)}(${r})`
		default: return `@${sign16(f.ext) < 0 ? `-${octal(-sign16(f.ext))}` : octal(f.ext)}(${r})`
	}
}

/** Registers a field reads and writes, by descriptor id. */
function fieldResources(f: Field, floating: boolean, reads: string[], writes: string[], written: boolean) {
	if (f.mode === 0) {
		const id = floating ? `ac${f.reg}` : REGISTER_IDS[f.reg]
		reads.push(id)
		if (written) writes.push(id)
		return
	}
	if (f.reg !== 7 || f.mode < 2) reads.push(REGISTER_IDS[f.reg])
	if (f.reg !== 7 && f.mode >= 2 && f.mode <= 5) writes.push(REGISTER_IDS[f.reg])
}

export function decode(memory: Uint8Array, address: number, features: Features): CpuInstruction {
	const fetch = (a: number) => {
		const low = a & 0xffff, high = a + 1 & 0xffff
		if (high >= memory.length || memory[low] === undefined || memory[high] === undefined) throw new Error('PDP-11 instruction outside memory')
		return memory[low] | memory[high] << 8
	}
	if (address & 1) throw new Error('Odd PDP-11 instruction address')
	const opcode = fetch(address)
	let size = 2
	const field = (code: number): Field => {
		const mode = code >>> 3 & 7, reg = code & 7, ext = mode >= 6 || reg === 7 && (mode === 2 || mode === 3) ? (size += 2, fetch(address + size - 2)) : 0
		return { mode, reg, ext, next: address + size & 0xffff }
	}
	const reads: string[] = [], writes: string[] = []
	const make = (text: string, execute: (c: CpuContext) => void, extra: Partial<CpuInstruction> = {}): CpuInstruction => {
		const traced = extra.kind !== 'return' || !text.startsWith('RTT')
		return {
			size, text, reads, writes, kind: 'alu', ...extra,
			execute(c) {
				const tracing = traced && !!(c.r[PSW] & T)
				pswStored = false
				try {
					execute(c)
					if (tracing) throw new Trap(BREAKPOINT, 'Trace trap')
				} catch (error) {
					if (error instanceof Trap) enterTrap(c, error)
					else throw error
				}
			},
		}
	}
	const reserved = (reason: string) => make(`.WORD ${opcodeText(opcode)}`, () => { throw new Trap(RESERVED, `Reserved instruction ${opcodeText(opcode)}${reason ? ` (${reason})` : ''}`) }, { kind: 'system' })
	const name = (key: number) => byOpcode.get(key)
	const gate = (mnemonic: string): string | null => {
		const needs = table[mnemonic].needs
		return needs && !features[needs] ? `${mnemonic.toUpperCase()} requires ${REQUIREMENT_TEXT[needs]}` : null
	}
	const psw = () => { reads.push('psw'); writes.push('psw') }

	// Double operand.
	const doubleCode = opcode & 0o070000
	if (doubleCode && doubleCode !== 0o070000) {
		const mnemonic = name(opcode & 0o170000)!, byte = !!(opcode & 0o100000) && mnemonic !== 'sub', width = byte ? 1 : 2
		const src = field(opcode >>> 6 & 63), dst = field(opcode & 63)
		const kind = mnemonic.slice(0, 3)
		fieldResources(src, false, reads, writes, false)
		fieldResources(dst, false, reads, writes, kind !== 'cmp' && kind !== 'bit')
		psw()
		const mask = byte ? 0xff : 0xffff, signBit = byte ? 0x80 : 0x8000
		return make(`${mnemonic.toUpperCase()} ${fieldText(src, false)}, ${fieldText(dst, false)}`, c => {
			const s = load(c, place(c, src, width), width)
			if (kind === 'mov') {
				const p = place(c, dst, width)
				if (byte && p.at < 0) store(c, p, sign8(s) & 0xffff, 2)
				else store(c, p, s, width)
				setFlags(c, !!(s & signBit), !s, false, carry(c))
				return
			}
			const p = place(c, dst, width), d = load(c, p, width)
			let r: number
			switch (kind) {
				case 'cmp': r = s - d & mask; setFlags(c, !!(r & signBit), !r, !!((s ^ d) & (s ^ r) & signBit), s < d); return
				case 'bit': r = s & d; setFlags(c, !!(r & signBit), !r, false, carry(c)); return
				case 'bic': r = d & ~s & mask; setFlags(c, !!(r & signBit), !r, false, carry(c)); break
				case 'bis': r = (d | s) & mask; setFlags(c, !!(r & signBit), !r, false, carry(c)); break
				case 'add': r = s + d & mask; setFlags(c, !!(r & signBit), !r, !!(~(s ^ d) & (s ^ r) & signBit), s + d > mask); break
				default: r = d - s & mask; setFlags(c, !!(r & signBit), !r, !!((d ^ s) & (d ^ r) & signBit), d < s)
			}
			store(c, p, r, width)
		}, { kind: kind === 'mov' ? dst.mode ? 'store' : 'load' : 'alu' })
	}

	// Branches.
	if ((opcode & 0o077400) >= 0o000400 && (opcode & 0o077400) <= 0o003400 || (opcode & 0o177400) >= 0o100000 && (opcode & 0o177400) <= 0o103400) {
		const mnemonic = name(opcode & 0o177400)!, target = address + 2 + sign8(opcode) * 2 & 0xffff
		if (mnemonic !== 'br') reads.push('psw')
		return make(`${mnemonic.toUpperCase()} ${octal(target)}`, c => c.branch(target, condition(c, opcode)), { kind: 'branch' })
	}

	// Single operand.
	const singleKey = opcode & 0o177700
	const singleName = name(singleKey)
	if (singleName && table[singleName].form === Form.Single) {
		const blocked = gate(singleName)
		if (blocked) return reserved(blocked)
		const s = table[singleName], byte = !!s.byte, width = byte ? 1 : 2, mask = byte ? 0xff : 0xffff, signBit = byte ? 0x80 : 0x8000
		const dst = field(opcode & 63), text = `${singleName.toUpperCase()} ${fieldText(dst, false)}`
		if (singleName === 'jmp') {
			fieldResources(dst, false, reads, writes, false)
			return make(text, c => {
				if (dst.mode === 0) throw new Trap(BUS_ERROR, 'JMP to a register is an illegal instruction')
				const target = effective(c, dst, 2)
				if (dst.mode === 3 && dst.reg === 6) c.ret(target)
				else c.branch(target, true)
			}, { kind: 'jump' })
		}
		const written = !['tst', 'tstb', 'mtps'].includes(singleName)
		fieldResources(dst, false, reads, writes, written)
		psw()
		const base = byte ? singleName.slice(0, -1) : singleName
		return make(text, c => {
			if (singleName === 'mtps') { const v = load(c, place(c, dst, 1), 1); c.r[PSW] = c.r[PSW] & T | v & ~T & 0xff; return }
			if (singleName === 'mfps') {
				const p = place(c, dst, 1), v = c.r[PSW] & 0xff
				if (p.at < 0) store(c, p, sign8(v) & 0xffff, 2); else store(c, p, v, 1)
				setFlags(c, !!(v & 0x80), !v, false, carry(c)); return
			}
			const p = place(c, dst, width)
			if (base === 'clr') { store(c, p, 0, width); setFlags(c, false, true, false, false); return }
			if (base === 'sxt') { const n = !!(c.r[PSW] & N); store(c, p, n ? 0xffff : 0, 2); c.r[PSW] = c.r[PSW] & ~(Z | V) | (n ? 0 : Z); return }
			const d = load(c, p, width), cin = carry(c) ? 1 : 0
			let r: number, v = false, cf = carry(c)
			switch (base) {
				case 'swab': r = (d >>> 8 | d << 8) & 0xffff; store(c, p, r, 2); setFlags(c, !!(r & 0x80), !(r & 0xff), false, false); return
				case 'tst': setFlags(c, !!(d & signBit), !d, false, false); return
				case 'com': r = ~d & mask; cf = true; break
				case 'inc': r = d + 1 & mask; v = d === signBit - 1; break
				case 'dec': r = d - 1 & mask; v = d === signBit; break
				case 'neg': r = -d & mask; v = r === signBit; cf = r !== 0; break
				case 'adc': r = d + cin & mask; v = !!cin && d === signBit - 1; cf = !!cin && d === mask; break
				case 'sbc': r = d - cin & mask; v = !!cin && d === signBit; cf = !!cin && d === 0; break
				case 'ror': r = d >>> 1 | (cin ? signBit : 0); cf = !!(d & 1); v = !!(r & signBit) !== cf; break
				case 'rol': r = d << 1 & mask | cin; cf = !!(d & signBit); v = !!(r & signBit) !== cf; break
				case 'asr': r = d >>> 1 | d & signBit; cf = !!(d & 1); v = !!(r & signBit) !== cf; break
				default: r = d << 1 & mask; cf = !!(d & signBit); v = !!(r & signBit) !== cf
			}
			store(c, p, r, width)
			setFlags(c, !!(r & signBit), !r, v, cf)
		})
	}

	// JSR, RTS, EIS, XOR, SOB, FIS.
	if ((opcode & 0o177000) === 0o004000) {
		const r = opcode >>> 6 & 7, dst = field(opcode & 63)
		fieldResources(dst, false, reads, writes, false)
		reads.push(REGISTER_IDS[r], 'sp'); writes.push(REGISTER_IDS[r], 'sp')
		return make(`JSR ${REGISTER_NAMES[r]}, ${fieldText(dst, false)}`, c => {
			if (dst.mode === 0) throw new Trap(BUS_ERROR, 'JSR to a register is an illegal instruction')
			const target = effective(c, dst, 2)
			push(c, readRegister(c, r, c.pc))
			if (r !== 7) writeRegister(c, r, c.pc)
			c.call(target, c.pc)
		}, { kind: 'call', call: true })
	}
	if ((opcode & 0o177770) === 0o000200) {
		const r = opcode & 7
		reads.push(REGISTER_IDS[r], 'sp'); writes.push(REGISTER_IDS[r], 'sp')
		return make(`RTS ${REGISTER_NAMES[r]}`, c => {
			const target = readRegister(c, r, c.pc), saved = pop(c)
			if (r !== 7) writeRegister(c, r, saved)
			c.ret(r === 7 ? saved : target)
		}, { kind: 'return' })
	}
	if ((opcode & 0o170000) === 0o070000) {
		const group = opcode & 0o177000, r = opcode >>> 6 & 7
		if (group === 0o077000) {
			const blocked = gate('sob')
			if (blocked) return reserved(blocked)
			const target = address + 2 - (opcode & 63) * 2 & 0xffff
			reads.push(REGISTER_IDS[r]); writes.push(REGISTER_IDS[r])
			return make(`SOB ${REGISTER_NAMES[r]}, ${octal(target)}`, c => { const value = readRegister(c, r, c.pc) - 1 & 0xffff; writeRegister(c, r, value); c.branch(target, value !== 0) }, { kind: 'branch' })
		}
		if (group === 0o075000) {
			if ((opcode & 0o777) >= 0o040) return reserved('')
			const mnemonic = name(opcode & 0o177770)!, blocked = gate(mnemonic)
			if (blocked) return reserved(blocked)
			reads.push(REGISTER_IDS[opcode & 7]); writes.push(REGISTER_IDS[opcode & 7]); psw()
			return make(`${mnemonic.toUpperCase()} ${REGISTER_NAMES[opcode & 7]}`, c => executeFis(c, opcode))
		}
		if (group === 0o076000) return reserved('')
		const mnemonic = name(group)!, blocked = gate(mnemonic)
		if (blocked) return reserved(blocked)
		const operand = field(opcode & 63)
		fieldResources(operand, false, reads, writes, mnemonic === 'xor')
		reads.push(REGISTER_IDS[r]); psw()
		if (mnemonic !== 'xor') writes.push(REGISTER_IDS[r], ...(mnemonic === 'ash' || r & 1 ? [] : [REGISTER_IDS[r | 1]]))
		if (mnemonic === 'div' || mnemonic === 'ashc') reads.push(REGISTER_IDS[r | 1])
		const text = mnemonic === 'xor' ? `XOR ${REGISTER_NAMES[r]}, ${fieldText(operand, false)}` : `${mnemonic.toUpperCase()} ${fieldText(operand, false)}, ${REGISTER_NAMES[r]}`
		return make(text, c => {
			if (mnemonic === 'xor') {
				const p = place(c, operand, 2), value = load(c, p, 2) ^ readRegister(c, r, c.pc)
				store(c, p, value, 2); setFlags(c, !!(value & 0x8000), !value, false, carry(c)); return
			}
			const src = load(c, place(c, operand, 2), 2), reg = readRegister(c, r, c.pc)
			if (mnemonic === 'mul') {
				const product = sign16(reg) * sign16(src)
				if (r & 1) writeRegister(c, r, product & 0xffff)
				else { writeRegister(c, r, product >>> 16 & 0xffff); writeRegister(c, r | 1, product & 0xffff) }
				setFlags(c, product < 0, product === 0, false, product < -0x8000 || product > 0x7fff)
				return
			}
			if (mnemonic === 'div') {
				const divisor = sign16(src), dividend = (reg << 16 | readRegister(c, r | 1, c.pc)) | 0
				if (!divisor) { setFlags(c, false, true, true, true); return }
				const quotient = Math.trunc(dividend / divisor)
				if (quotient < -0x8000 || quotient > 0x7fff) { setFlags(c, false, false, true, false); return }
				writeRegister(c, r, quotient & 0xffff); writeRegister(c, r | 1, dividend - quotient * divisor & 0xffff)
				setFlags(c, quotient < 0, quotient === 0, false, false)
				return
			}
			const count = src << 26 >> 26, wide = mnemonic === 'ashc'
			let value = wide ? (r & 1 ? reg << 16 | reg : reg << 16 | readRegister(c, r | 1, c.pc)) | 0 : sign16(reg), cf = false, v = false
			const top = wide ? 0x80000000 | 0 : 0x8000
			for (let i = 0; i < Math.abs(count); i++) {
				if (count > 0) {
					cf = !!(value & top)
					const next = wide ? value << 1 : sign16(value << 1)
					v ||= (next < 0) !== (value < 0)
					value = next
				} else { cf = !!(value & 1); value >>= 1 }
			}
			if (wide) {
				if (r & 1) writeRegister(c, r, value & 0xffff)
				else { writeRegister(c, r, value >>> 16 & 0xffff); writeRegister(c, r | 1, value & 0xffff) }
			} else writeRegister(c, r, value & 0xffff)
			setFlags(c, value < 0, wide ? value === 0 : (value & 0xffff) === 0, v, cf)
		})
	}

	// Traps, MARK, SPL, condition codes and the no-operand instructions.
	if ((opcode & 0o177000) === 0o104000) {
		const emt = opcode < 0o104400, code = opcode & 255
		reads.push('sp', 'psw'); writes.push('sp', 'psw')
		return make(`${emt ? 'EMT' : 'TRAP'} ${octal(code)}`, c => {
			if (emt && !c.read(EMT_VECTOR, 2) && !c.read(EMT_VECTOR + 2, 2)) { monitor(c, code); return }
			throw new Trap(emt ? EMT_VECTOR : TRAP_VECTOR, emt ? `EMT ${octal(code)}` : `TRAP ${octal(code)}`)
		}, { kind: 'system', call: true, ...(emt ? { reads: [...reads, 'r0'], writes: [...writes, 'r0'] } : {}) })
	}
	if ((opcode & 0o177700) === 0o006400) {
		const blocked = gate('mark')
		if (blocked) return reserved(blocked)
		const n = opcode & 63
		reads.push('r5', 'sp'); writes.push('r5', 'sp')
		return make(`MARK ${octal(n)}`, c => { c.r[SP] = c.pc + 2 * n & 0xffff; const target = c.r[5]; c.r[5] = pop(c); c.ret(target) }, { kind: 'return' })
	}
	if ((opcode & 0o177770) === 0o000230) {
		const blocked = gate('spl')
		if (blocked) return reserved(blocked)
		psw()
		return make(`SPL ${opcode & 7}`, c => { c.r[PSW] = c.r[PSW] & ~0o340 | (opcode & 7) << 5 })
	}
	if ((opcode & 0o177740) === 0o000240) {
		const known = name(opcode)
		const bits = ['C', 'V', 'Z', 'N'].filter((_, i) => opcode & 1 << i)
		psw()
		return make(known ? known.toUpperCase() : bits.map(flag => `${opcode & 0o20 ? 'SE' : 'CL'}${flag}`).join('!'), c => {
			if (opcode & 0o20) c.r[PSW] |= opcode & 15
			else c.r[PSW] &= ~(opcode & 15)
		})
	}
	if (opcode <= 6) {
		const mnemonic = name(opcode)!, blocked = gate(mnemonic)
		if (blocked) return reserved(blocked)
		switch (opcode) {
			case 0: return make('HALT', c => c.halt(), { kind: 'system' })
			case 1: return make('WAIT', c => c.halt(), { kind: 'system' })
			case 2: case 6: reads.push('sp'); writes.push('sp', 'psw')
				return make(opcode === 2 ? 'RTI' : 'RTT', c => { const target = pop(c); c.r[PSW] = pop(c) & 0xff; c.ret(target) }, { kind: 'return' })
			case 3: case 4: reads.push('sp', 'psw'); writes.push('sp', 'psw')
				return make(opcode === 3 ? 'BPT' : 'IOT', () => { throw new Trap(opcode === 3 ? BREAKPOINT : IOT_VECTOR, opcode === 3 ? 'BPT' : 'IOT') }, { kind: 'system', call: true })
			default: return make('RESET', () => {}, { kind: 'system' })
		}
	}

	// FP11.
	if ((opcode & 0o170000) === 0o170000) {
		if (!features.fp11) return reserved(`${REQUIREMENT_TEXT.fp11} is not present`)
		const group = opcode & 0o177700, wide = opcode & 0o177400
		const operand = group === 0o170000 ? null : field(opcode & 63)
		const ac = opcode >>> 6 & 3
		reads.push('fps')
		const fp = (mnemonic: string, text: string) => make(`${mnemonic} ${text}`.trim(), c => executeFloat(c, opcode, operand ?? { mode: 0, reg: 0, ext: 0, next: c.pc }))
		const fd = (o: Field) => fieldText(o, true), gd = (o: Field) => fieldText(o, false)
		if (group === 0o170000) {
			const mnemonic = name(opcode)
			if (!mnemonic) return reserved('')
			writes.push(mnemonic === 'cfcc' ? 'psw' : 'fps')
			return fp(mnemonic.toUpperCase(), '')
		}
		writes.push('fps')
		switch (group) {
			case 0o170100: fieldResources(operand!, false, reads, writes, false); return fp('LDFPS', gd(operand!))
			case 0o170200: fieldResources(operand!, false, reads, writes, true); return fp('STFPS', gd(operand!))
			case 0o170300: fieldResources(operand!, false, reads, writes, true); return fp('STST', gd(operand!))
			case 0o170400: case 0o170500: case 0o170600: case 0o170700:
				fieldResources(operand!, true, reads, writes, group !== 0o170500)
				return fp(['CLRF', 'TSTF', 'ABSF', 'NEGF'][(group - 0o170400) >>> 6], fd(operand!))
		}
		const names: Record<number, [string, number]> = {
			0o171000: ['MULF', 0], 0o171400: ['MODF', 0], 0o172000: ['ADDF', 0], 0o172400: ['LDF', 0], 0o173000: ['SUBF', 0], 0o173400: ['CMPF', 0],
			0o174000: ['STF', 1], 0o174400: ['DIVF', 0], 0o175000: ['STEXP', 3], 0o175400: ['STCFI', 3], 0o176000: ['STCFD', 1], 0o176400: ['LDEXP', 2], 0o177000: ['LDCIF', 2], 0o177400: ['LDCDF', 0],
		}
		const [mnemonic, shape] = names[wide]
		const floating = shape === 0 || shape === 1, toMemory = shape === 1 || shape === 3
		fieldResources(operand!, floating, reads, writes, toMemory)
		const acId = `ac${ac}`
		if (!toMemory || mnemonic === 'MODF') writes.push(acId, ...(mnemonic === 'MODF' && !(ac & 1) ? [`ac${ac | 1}`] : []))
		if (mnemonic !== 'LDF' && mnemonic !== 'LDCIF' && mnemonic !== 'LDCDF') reads.push(acId)
		if (shape === 3) writes.push('psw')
		const text = floating ? fd(operand!) : gd(operand!)
		return fp(mnemonic, toMemory ? `AC${ac}, ${text}` : `${text}, AC${ac}`)
	}
	return reserved('')
}

export const registerNames = REGISTER_NAMES
