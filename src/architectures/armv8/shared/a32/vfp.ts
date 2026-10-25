/**
 * VFPv4-D16 in the A32 coprocessor 10 and 11 space (ARM DDI 0487, F5.1.x
 * "Floating-point data-processing", "Advanced SIMD and floating-point
 * 32-bit/64-bit register transfer", "Load/store"): one plain record per
 * word, shared by the CPU, the disassembler and the tools. S0-S31 and
 * D0-D15 only: a D register field naming D16-D31 is undefined, as are the
 * half-precision and Advanced SIMD forms.
 */

/** Kinds of a decoded VFP word. */
export const VK_ARITH = 1
export const VK_MOV_IMM = 2
/** VMOV, VABS, VNEG, VSQRT: `op` is a VU_*. */
export const VK_UNARY = 3
/** VCMP and VCMPE; `zero` for the #0 form. */
export const VK_COMPARE = 4
/** VCVT between F32 and F64. */
export const VK_CONVERT = 5
/** VCVT{R} to a 32-bit integer. */
export const VK_TO_INT = 6
export const VK_FROM_INT = 7
/** VCVT to or from fixed point, in place. */
export const VK_FIXED = 8
/** VMOV between a core register and an S register. */
export const VK_CORE_SINGLE = 9
/** VMOV between two core registers and a D register or two S registers. */
export const VK_CORE_PAIR = 10
export const VK_VMRS = 11
export const VK_VMSR = 12
/** VLDR and VSTR. */
export const VK_TRANSFER = 13
/** VLDM, VSTM, VPUSH and VPOP. */
export const VK_BLOCK = 14

/** VK_ARITH operations: bit 23, bits 21-20 and bit 6 of the word. */
export const VA_MLA = 0
export const VA_MLS = 1
export const VA_NMLS = 2
export const VA_NMLA = 3
export const VA_MUL = 4
export const VA_NMUL = 5
export const VA_ADD = 6
export const VA_SUB = 7
export const VA_DIV = 8
export const VA_FNMS = 10
export const VA_FNMA = 11
export const VA_FMA = 12
export const VA_FMS = 13

export const ARITH_NAMES: readonly (string | null)[] = Object.freeze(['vmla', 'vmls', 'vnmls', 'vnmla', 'vmul', 'vnmul', 'vadd', 'vsub', 'vdiv', null, 'vfnms', 'vfnma', 'vfma', 'vfms'])

export const VU_MOV = 0
export const VU_ABS = 1
export const VU_NEG = 2
export const VU_SQRT = 3
export const UNARY_NAMES: readonly string[] = Object.freeze(['vmov', 'vabs', 'vneg', 'vsqrt'])

export interface VfpInstruction {
	readonly kind: number
	/** VA_* or VU_*. */
	readonly op: number
	/** The precision the operation works in (sz). */
	readonly double: boolean
	/** Destination, an S index or a D index as `dDouble` says. */
	readonly d: number
	readonly dDouble: boolean
	readonly n: number
	readonly m: number
	readonly mDouble: boolean
	readonly rt: number
	readonly rt2: number
	readonly rn: number
	/** Toward core registers, or a load. */
	readonly load: boolean
	readonly up: boolean
	readonly writeback: boolean
	/** imm8 of VMOV; byte offset of VLDR; words of VLDM; fraction bits of fixed point. */
	readonly imm: number
	/** An integer operand is signed. */
	readonly signed: boolean
	/** VCVT to an integer rounds toward zero; VCVTR uses FPSCR. */
	readonly roundZero: boolean
	/** Fixed-point width, 16 or 32. */
	readonly size: number
	/** VCMPE. */
	readonly signal: boolean
	/** VCMP with #0. */
	readonly zero: boolean
}

const NONE: VfpInstruction = Object.freeze({
	kind: 0, op: 0, double: false, d: 0, dDouble: false, n: 0, m: 0, mDouble: false, rt: 0, rt2: 0, rn: 0, load: false, up: false, writeback: false,
	imm: 0, signed: false, roundZero: false, size: 32, signal: false, zero: false,
})

const R_PC = 15

/** S index from a 4-bit field and its extra bit. */
const single = (field: number, bit: number) => (field << 1) | bit

/** A register of either kind, or -1 for D16-D31. */
const register = (field: number, bit: number, double: boolean) => double ? (bit ? -1 : field) : single(field, bit)

function make(fields: Partial<VfpInstruction>): VfpInstruction | null {
	const record = { ...NONE, ...fields }
	if (record.d < 0 || record.n < 0 || record.m < 0) return null
	return Object.freeze(record)
}

function dataProcessing(word: number): VfpInstruction | null {
	const double = (word & 0x100) !== 0
	const vd = (word >>> 12) & 15, D = (word >>> 22) & 1
	const vn = (word >>> 16) & 15, N = (word >>> 7) & 1
	const vm = word & 15, M = (word >>> 5) & 1
	const d = register(vd, D, double)
	const m = register(vm, M, double)
	const key = (((word >>> 23) & 1) << 3) | (((word >>> 20) & 3) << 1) | ((word >>> 6) & 1)
	if (key < 14) {
		if (ARITH_NAMES[key] === null) return null
		return make({ kind: VK_ARITH, op: key, double, d, dDouble: double, n: register(vn, N, double), m, mDouble: double })
	}
	if (!(word & 0x40)) {
		if (word & 0xB0) return null
		return make({ kind: VK_MOV_IMM, double, d, dDouble: double, imm: (vn << 4) | vm })
	}
	const opc2 = vn
	const high = (word >>> 7) & 1
	switch (opc2) {
		case 0: case 1:
			return make({ kind: VK_UNARY, op: opc2 * 2 + high, double, d, dDouble: double, m, mDouble: double })
		case 4:
			return make({ kind: VK_COMPARE, double, d, dDouble: double, m, mDouble: double, signal: high === 1 })
		case 5:
			if (word & 0x2F) return null
			return make({ kind: VK_COMPARE, double, d, dDouble: double, zero: true, signal: high === 1 })
		case 7:
			if (!high) return null
			// sz names the source; the destination is the other precision.
			return make({ kind: VK_CONVERT, double, d: register(vd, D, !double), dDouble: !double, m, mDouble: double })
		case 8:
			return make({ kind: VK_FROM_INT, double, d, dDouble: double, m: single(vm, M), signed: high === 1 })
		case 12: case 13:
			return make({ kind: VK_TO_INT, double, d: single(vd, D), m, mDouble: double, signed: opc2 === 13, roundZero: high === 1 })
		case 10: case 11: case 14: case 15: {
			const size = high ? 32 : 16
			const imm5 = ((word & 15) << 1) | M
			if (imm5 > size) return null
			// `load` here: toward fixed point.
			return make({ kind: VK_FIXED, double, d, dDouble: double, m: d, mDouble: double, load: opc2 >= 14, signed: !(opc2 & 1), size, imm: size - imm5 })
		}
	}
	return null
}

function transfer(word: number): VfpInstruction | null {
	if (word & 0x100) return null
	const load = (word & 0x00100000) !== 0
	const rt = (word >>> 12) & 15
	switch ((word >>> 21) & 7) {
		case 0:
			if ((word & 0x7F) !== 0x10 || rt === R_PC) return null
			return make({ kind: VK_CORE_SINGLE, load, rt, n: single((word >>> 16) & 15, (word >>> 7) & 1) })
		case 7:
			if (((word >>> 16) & 15) !== 1 || (word & 0xFF) !== 0x10) return null
			if (!load && rt === R_PC) return null
			return make({ kind: load ? VK_VMRS : VK_VMSR, load, rt })
	}
	return null
}

function loadStore(word: number): VfpInstruction | null {
	const double = (word & 0x100) !== 0
	const pu = (word >>> 23) & 3
	const writeback = (word & 0x00200000) !== 0
	const load = (word & 0x00100000) !== 0
	const rn = (word >>> 16) & 15
	const vd = (word >>> 12) & 15, D = (word >>> 22) & 1
	const imm8 = word & 0xFF
	if (pu === 0) {
		// 64-bit transfers between two core registers and D or a pair of S.
		if ((word & 0x01E00000) !== 0x00400000 || (word & 0xD0) !== 0x10) return null
		const rt2 = rn, rt = vd
		if (rt === R_PC || rt2 === R_PC || (load && rt === rt2)) return null
		const vm = word & 15, M = (word >>> 5) & 1
		const m = register(vm, M, double)
		if (!double && m > 30) return null
		return make({ kind: VK_CORE_PAIR, double, load, rt, rt2, m, mDouble: double })
	}
	if (pu & 2 && !writeback) {
		return make({ kind: VK_TRANSFER, double, load, rn, d: register(vd, D, double), dDouble: double, up: (pu & 1) === 1, imm: imm8 * 4 })
	}
	if (pu === 3) return null
	// VLDM/VSTM: IA (01), or DB with writeback (10).
	if (writeback && rn === R_PC) return null
	const first = register(vd, D, double)
	const count = double ? imm8 / 2 : imm8
	if (first < 0 || count === 0 || !Number.isInteger(count) || first + count > (double ? 16 : 32)) return null
	return make({ kind: VK_BLOCK, double, load, rn, d: first, dDouble: double, up: pu === 1, writeback, imm: imm8 })
}

function decodeWord(word: number): VfpInstruction | null {
	if (((word >>> 9) & 7) !== 5 || word >>> 28 === 15) return null
	const top = (word >>> 24) & 15
	if (top === 14) return word & 0x10 ? transfer(word) : dataProcessing(word)
	if (top === 12 || top === 13) return loadStore(word)
	return null
}

const CACHE_LIMIT = 4096
const cache = new Map<number, VfpInstruction | null>()

/** The VFP instruction `word` encodes, or null where it is none this core has. */
export function decodeVfp(word: number): VfpInstruction | null {
	word >>>= 0
	const cached = cache.get(word)
	if (cached !== undefined) return cached
	if (cache.size >= CACHE_LIMIT) cache.clear()
	const decoded = decodeWord(word)
	cache.set(word, decoded)
	return decoded
}

/** FPSCR bits VMSR may write: NZCV, AHP, DN, FZ, RMode and the cumulative flags. */
export const FPSCR_WRITABLE = 0xF7C0009F
