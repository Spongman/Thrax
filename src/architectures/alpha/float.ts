import { BinaryException, binaryNegate, calculateBinary, compareBinary, integerBinary, packBinary, roundBinary, sqrtBinary, unpackBinary, type BinaryFloat, type BinaryFormat, type BinaryResult, type BinaryRounding } from '../../core/binaryFloat'

/** Native register file layout: $0-$31, $f0-$f31, then FPCR. */
export const FP = 32, FPCR = 64
/** DYN = normal rounding; every status and disable bit clear. */
export const FPCR_RESET = 0x0800000000000000n
/** FPCR<63:48>; the reserved low bits read as zero. */
export const FPCR_MASK = 0xffff000000000000n
/** CMPTxx true result. */
export const TWO = 0x4000000000000000n

const { invalid: INVALID, zeroDivide: ZERO_DIVIDE, overflow: OVERFLOW, underflow: UNDERFLOW, inexact: INEXACT } = BinaryException
const INTEGER_OVERFLOW = 64
const SIGN = 1n << 63n

interface Format { frac: number, exp: number, binary: BinaryFormat }
const S: Format = { frac: 23, exp: 8, binary: { precision: 24, minExponent: -126, maxExponent: 127 } }
const T: Format = { frac: 52, exp: 11, binary: { precision: 53, minExponent: -1022, maxExponent: 1023 } }

/** LDS: S_floating memory longword to register (T layout). */
export function sToRegister(m: bigint): bigint {
	const e = Number(m >> 23n & 255n), x = e === 255 ? 0x7ff : e === 0 ? 0 : e & 0x80 ? 0x400 | e & 0x7f : 0x380 | e & 0x7f
	return (m >> 31n & 1n) << 63n | BigInt(x) << 52n | (m & 0x7fffffn) << 29n
}
/** STS: register bits <63:62> and <58:29> to an S_floating memory longword. */
export const registerToS = (r: bigint): bigint => r >> 32n & 0xc0000000n | r >> 29n & 0x3fffffffn

const exponentMax = (f: Format) => (1n << BigInt(f.exp)) - 1n
const exponentOf = (f: Format, x: bigint) => x >> BigInt(f.frac) & exponentMax(f)
const fractionOf = (f: Format, x: bigint) => x & (1n << BigInt(f.frac)) - 1n
const quietBit = (f: Format) => 1n << BigInt(f.frac - 1)
const isNaN = (f: Format, x: bigint) => exponentOf(f, x) === exponentMax(f) && fractionOf(f, x) !== 0n
const signaling = (f: Format, x: bigint) => isNaN(f, x) && !(x & quietBit(f))
const defaultNaN = (f: Format) => exponentMax(f) << BigInt(f.frac) | quietBit(f)
const unpack = (f: Format, x: bigint) => unpackBinary(x, f.frac, f.exp)
const bitsOf = (f: Format, r: bigint) => f === S ? registerToS(r) : r
const registerOf = (f: Format, x: bigint) => f === S ? sToRegister(x) : x

/** [flag, FPCR status bit, FPCR disable bit, name, trap enabled by qualifier]. */
const EXCEPTIONS: readonly [number, number, number, string, (trap: string) => boolean][] = [
	[INVALID, 52, 49, 'invalid operation', () => true],
	[ZERO_DIVIDE, 53, 50, 'division by zero', () => true],
	[OVERFLOW, 54, 51, 'overflow', () => true],
	[UNDERFLOW, 55, 61, 'underflow', trap => trap.includes('u')],
	[INEXACT, 56, 62, 'inexact result', trap => trap.includes('i')],
	[INTEGER_OVERFLOW, 57, -1, 'integer overflow', trap => trap.includes('v')],
]

/** Trap (throw) on an enabled exception, otherwise set sticky status and SUM. */
function signal(fpcr: bigint, flags: number, trap: string): bigint {
	const software = trap.includes('s')
	const trapped = EXCEPTIONS.filter(([flag, , disable, , enabled]) => flags & flag && enabled(trap) && !(software && disable >= 0 && fpcr >> BigInt(disable) & 1n))
	if (trapped.length) throw new Error(`Alpha arithmetic trap: ${trapped.map(entry => entry[3]).join(', ')}`)
	let status = 0n
	for (const [flag, bit] of EXCEPTIONS) if (flags & flag) status |= 1n << BigInt(bit)
	return status ? fpcr | status | SIGN : fpcr
}

const DYNAMIC: readonly BinaryRounding[] = ['zero', 'down', 'nearest', 'up']
const convert = (f: Format, v: BinaryFloat, mode: BinaryRounding): BinaryResult => v.special ? { value: v, flags: 0, roundedUp: false } : roundBinary(v.negative, v.significand, v.exponent, 1n, f.binary, mode)

/** Pack a rounded result; tiny results become true zero unless /U and FPCR permit a denormal. */
function finish(f: Format, r: BinaryResult, trap: string, fpcr: bigint): { bits: bigint, flags: number } {
	let flags = r.flags & ~BinaryException.denormal
	if (r.value.special === 'nan') return { bits: defaultNaN(f), flags }
	let bits = packBinary(r.value, f.frac, f.exp)
	if (flags & UNDERFLOW || exponentOf(f, bits) === 0n && fractionOf(f, bits) !== 0n) {
		flags |= UNDERFLOW
		if (!trap.includes('u') || fpcr >> 60n & 1n) { bits = 0n; flags |= INEXACT }
	}
	return { bits, flags }
}

/** Quiet the first NaN operand (Fa before Fb); a signaling NaN is invalid. */
function propagate(f: Format, operands: readonly bigint[]): { bits: bigint, flags: number } | null {
	const nan = operands.find(x => isNaN(f, x))
	return nan === undefined ? null : { bits: nan | quietBit(f), flags: operands.some(x => signaling(f, x)) ? INVALID : 0 }
}

/** FBxx and FCMOVxx test register bits, so -0.0 is zero and the sign bit decides. */
export function floatCondition(condition: string, r: bigint): boolean {
	const zero = (r & ~SIGN) === 0n, negative = !!(r & SIGN)
	switch (condition) {
		case 'eq': return zero
		case 'ne': return !zero
		case 'lt': return negative && !zero
		case 'ge': return !negative || zero
		case 'le': return negative || zero
		default: return !negative && !zero
	}
}

/** Pure operate semantics; throws before any state change when an exception traps. */
export function executeFloat(name: string, fpcr: bigint, a: bigint, b: bigint): { value: bigint, fpcr: bigint } {
	const [base, qualifier = ''] = name.split('/')
	const round = /[cmd]$/.test(qualifier) ? qualifier.slice(-1) : '', trap = qualifier.slice(0, qualifier.length - round.length)
	const mode: BinaryRounding = round === 'c' ? 'zero' : round === 'm' ? 'down' : round === 'd' ? DYNAMIC[Number(fpcr >> 58n & 3n)] : 'nearest'
	const done = (value: bigint, flags = 0) => ({ value, fpcr: signal(fpcr, flags, trap) })
	switch (base) {
		case 'cpys': return done(a & SIGN | b & ~SIGN)
		case 'cpysn': return done(~a & SIGN | b & ~SIGN)
		case 'cpyse': return done(a & 0xfff0000000000000n | b & 0x000fffffffffffffn)
		case 'itofs': return done(sToRegister(a & 0xffffffffn))
		case 'ftois': return done(BigInt.asUintN(64, BigInt.asIntN(32, registerToS(a))))
		case 'itoft': case 'ftoit': return done(a)
		case 'cvtst': {
			const x = registerToS(b)
			if (isNaN(S, x)) return done(sToRegister(x | quietBit(S)), signaling(S, x) ? INVALID : 0)
			return done(packBinary(unpack(S, x), T.frac, T.exp))
		}
		case 'cvtts': {
			if (isNaN(T, b)) return done(sToRegister(b >> 32n & 0x80000000n | 0x7f800000n | b >> 29n & 0x7fffffn | quietBit(S)), signaling(T, b) ? INVALID : 0)
			const out = finish(S, convert(S, unpack(T, b), mode), trap, fpcr)
			return done(sToRegister(out.bits), out.flags)
		}
		case 'cvttq': {
			if (exponentOf(T, b) === exponentMax(T)) return done(0n, INVALID)
			const r = integerBinary(unpack(T, b), mode)!
			const overflow = r.value < -(1n << 63n) || r.value >= 1n << 63n
			return done(BigInt.asUintN(64, r.value), (r.inexact ? INEXACT : 0) | (overflow ? INTEGER_OVERFLOW | INEXACT : 0))
		}
		case 'cvtqs': case 'cvtqt': {
			const f = base === 'cvtqs' ? S : T, n = BigInt.asIntN(64, b)
			const out = finish(f, roundBinary(n < 0n, n < 0n ? -n : n, 0, 1n, f.binary, mode), trap, fpcr)
			return done(registerOf(f, out.bits), out.flags)
		}
		case 'cmptun': case 'cmpteq': case 'cmptlt': case 'cmptle': {
			const kind = base.slice(4)
			if (isNaN(T, a) || isNaN(T, b)) return done(kind === 'un' ? TWO : 0n, signaling(T, a) || signaling(T, b) || kind === 'lt' || kind === 'le' ? INVALID : 0)
			const order = compareBinary(unpack(T, a), unpack(T, b))!
			return done(kind === 'eq' && order === 0 || kind === 'lt' && order < 0 || kind === 'le' && order <= 0 ? TWO : 0n)
		}
	}
	const f = base.endsWith('t') ? T : S, x = bitsOf(f, a), y = bitsOf(f, b), operation = base.slice(0, -1)
	if (!['add', 'sub', 'mul', 'div', 'sqrt'].includes(operation)) throw new Error(`Unsupported Alpha floating-point operation ${name}`)
	const out = propagate(f, operation === 'sqrt' ? [y] : [x, y]) ?? finish(f, operation === 'sqrt'
		? sqrtBinary(unpack(f, y), f.binary, mode)
		: calculateBinary(operation === 'mul' ? 'multiply' : operation === 'div' ? 'divide' : 'add', unpack(f, x), operation === 'sub' ? binaryNegate(unpack(f, y)) : unpack(f, y), f.binary, mode), trap, fpcr)
	return done(registerOf(f, out.bits), out.flags)
}

const IEEE = ['', 'u', 'su', 'sui'], INTEGER = ['', 'v', 'sv', 'svi'], INEXACT_ONLY = ['', 'sui'], COMPARE = ['', 'su']
const TRAP_FIELD: Record<string, number> = { '': 0, u: 1, v: 1, su: 5, sv: 5, sui: 7, svi: 7 }
/** RND field order: chopped, minus infinity, normal, dynamic. */
const ROUNDING = ['c', 'm', '', 'd']
/** [opcode, function with normal rounding and no trap, trap qualifiers, rounding qualifiers]. */
const QUALIFIED: Record<string, [number, number, readonly string[], boolean]> = {
	adds: [0x16, 0x080, IEEE, true], subs: [0x16, 0x081, IEEE, true], muls: [0x16, 0x082, IEEE, true], divs: [0x16, 0x083, IEEE, true],
	addt: [0x16, 0x0a0, IEEE, true], subt: [0x16, 0x0a1, IEEE, true], mult: [0x16, 0x0a2, IEEE, true], divt: [0x16, 0x0a3, IEEE, true],
	cmptun: [0x16, 0x0a4, COMPARE, false], cmpteq: [0x16, 0x0a5, COMPARE, false], cmptlt: [0x16, 0x0a6, COMPARE, false], cmptle: [0x16, 0x0a7, COMPARE, false],
	cvtts: [0x16, 0x0ac, IEEE, true], cvttq: [0x16, 0x0af, INTEGER, true], cvtqs: [0x16, 0x0bc, INEXACT_ONLY, true], cvtqt: [0x16, 0x0be, INEXACT_ONLY, true],
	sqrts: [0x14, 0x08b, IEEE, true], sqrtt: [0x14, 0x0ab, IEEE, true],
}
/** Operate-format mnemonic to [opcode, 11-bit function]. */
export const floatOperate = new Map<string, [number, number]>()
for (const [name, [op, fn, traps, rounds]] of Object.entries(QUALIFIED)) for (const trap of traps) for (const round of rounds ? ['', 'c', 'm', 'd'] : ['']) {
	floatOperate.set(trap + round ? `${name}/${trap}${round}` : name, [op, fn & 0x3f | (rounds ? ROUNDING.indexOf(round) : 2) << 6 | TRAP_FIELD[trap] << 8])
}
for (const [name, op, fn] of [
	['cvtst', 0x16, 0x2ac], ['cvtst/s', 0x16, 0x6ac],
	['cpys', 0x17, 0x020], ['cpysn', 0x17, 0x021], ['cpyse', 0x17, 0x022], ['mt_fpcr', 0x17, 0x024], ['mf_fpcr', 0x17, 0x025],
	['fcmoveq', 0x17, 0x02a], ['fcmovne', 0x17, 0x02b], ['fcmovlt', 0x17, 0x02c], ['fcmovge', 0x17, 0x02d], ['fcmovle', 0x17, 0x02e], ['fcmovgt', 0x17, 0x02f],
	['itofs', 0x14, 0x004], ['itoft', 0x14, 0x024], ['ftoit', 0x1c, 0x070], ['ftois', 0x1c, 0x078],
] as const) floatOperate.set(name, [op, fn])
export const floatOperateByWord = new Map([...floatOperate].map(([name, [op, fn]]) => [op << 11 | fn, name]))

export type FloatShape = 'binary' | 'unary' | 'fpcr' | 'itof' | 'ftoi'
export function floatShape(name: string): FloatShape {
	const base = name.split('/')[0]
	return base.startsWith('cvt') || base.startsWith('sqrt') ? 'unary' : base.endsWith('_fpcr') ? 'fpcr' : base.startsWith('itof') ? 'itof' : base.startsWith('ftoi') ? 'ftoi' : 'binary'
}
export const floatMemory: Record<string, number> = { lds: 0x22, ldt: 0x23, sts: 0x26, stt: 0x27 }
export const floatBranch: Record<string, number> = { fbeq: 0x31, fblt: 0x32, fble: 0x33, fbne: 0x35, fbge: 0x36, fbgt: 0x37 }
export const floatAliases = ['fmov', 'fneg', 'fabs', 'fclr', 'fnop']
export const floatInstructions = [...floatOperate.keys(), ...Object.keys(floatMemory), ...Object.keys(floatBranch), ...floatAliases]
