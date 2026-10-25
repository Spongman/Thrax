import { describe, expect, it } from 'vitest'
import {
	DOUBLE, encodeImm8, expandImm8, FPCR_DN, FPCR_FZ, FPSR_DZC, FPSR_IDC, FPSR_IOC, FPSR_IXC, FPSR_OFC, FPSR_UFC, FpEnv, fixedToFp, fpAdd, fpCompare,
	fpConvert, fpDiv, fpMinMax, fpMul, fpMulAdd, fpRoundInt, fpSqrt, fpToFixed, numberToBits, ROUND_NEGINF, ROUND_POSINF, ROUND_TIEAWAY, ROUND_TIEEVEN,
	ROUND_ZERO, SINGLE,
} from '../fp'

const s = (value: number) => numberToBits(value, SINGLE)
const d = (value: number) => numberToBits(value, DOUBLE)
const env = (mode = ROUND_TIEEVEN, extra = 0) => new FpEnv((mode << 22) | extra)

/** A deterministic stream of awkward doubles: mixed magnitudes, signs and denormals. */
function* randomDoubles(count: number): Generator<number> {
	let state = 0x12345678
	const next = () => {
		state = (Math.imul(state, 1103515245) + 12345) >>> 0
		return state
	}
	const view = new DataView(new ArrayBuffer(8))
	for (let index = 0; index < count; index++) {
		view.setUint32(0, next())
		view.setUint32(4, next())
		const value = view.getFloat64(0)
		if (Number.isFinite(value)) yield value
	}
}

describe('Arm FP pseudocode', () => {
	it('rounds add, mul, div and sqrt as IEEE round-to-nearest does', () => {
		const values = [...randomDoubles(400)]
		for (let index = 0; index + 1 < values.length; index++) {
			const [a, b] = [values[index], values[index + 1]]
			expect(fpAdd(d(a), d(b), DOUBLE, env())).toBe(d(a + b))
			expect(fpMul(d(a), d(b), DOUBLE, env())).toBe(d(a * b))
			expect(fpDiv(d(a), d(b), DOUBLE, env())).toBe(d(a / b))
			expect(fpSqrt(d(Math.abs(a)), DOUBLE, env())).toBe(d(Math.sqrt(Math.abs(a))))
			// Doubles hold a single's exact sum, product and quotient closely enough to round once.
			const [x, y] = [Math.fround(a * 1e-300), Math.fround(b)]
			// JS NaNs carry no Arm default NaN sign; those are tested apart.
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue
			expect(fpAdd(s(x), s(y), SINGLE, env())).toBe(s(x + y))
			expect(fpMul(s(x), s(y), SINGLE, env())).toBe(s(x * y))
			expect(fpDiv(s(y), s(x || 1), SINGLE, env())).toBe(s(y / (x || 1)))
		}
	})

	it('rounds in each mode and raises IXC', () => {
		const tiny = s(2 ** -24)
		for (const [mode, expected] of [[ROUND_TIEEVEN, 0x3F800000n], [ROUND_POSINF, 0x3F800001n], [ROUND_NEGINF, 0x3F800000n], [ROUND_ZERO, 0x3F800000n]] as const) {
			const e = env(mode)
			expect(fpAdd(s(1), tiny, SINGLE, e)).toBe(expected)
			expect(e.flags).toBe(FPSR_IXC)
		}
		// A tie away from zero only in TIEAWAY: 1 + 1.5 ulp.
		expect(fpAdd(s(1), s(3 * 2 ** -24), SINGLE, env(ROUND_TIEEVEN))).toBe(0x3F800002n)
		expect(fpAdd(s(-1), s(-(2 ** -24)), SINGLE, env(ROUND_NEGINF))).toBe(0xBF800001n)
		// Exact zero sums are -0 only rounding down.
		expect(fpAdd(s(1), s(-1), SINGLE, env())).toBe(0n)
		expect(fpAdd(s(1), s(-1), SINGLE, env(ROUND_NEGINF))).toBe(0x80000000n)
	})

	it('overflows, underflows and divides by zero with the right flags', () => {
		let e = env()
		expect(fpMul(s(3e38), s(2), SINGLE, e)).toBe(0x7F800000n)
		expect(e.flags).toBe(FPSR_OFC | FPSR_IXC)
		e = env(ROUND_ZERO)
		expect(fpMul(s(3e38), s(2), SINGLE, e)).toBe(0x7F7FFFFFn)
		e = env()
		// Half the smallest denormal ties to even: zero.
		expect(fpMul(s(2 ** -149), s(0.5), SINGLE, e)).toBe(0n)
		expect(e.flags).toBe(FPSR_UFC | FPSR_IXC)
		e = env()
		// An exact denormal result is not an underflow.
		expect(fpMul(s(2 ** -140), s(2 ** -5), SINGLE, e)).toBe(s(2 ** -145))
		expect(e.flags).toBe(0)
		e = env()
		expect(fpDiv(s(1), s(-0), SINGLE, e)).toBe(0xFF800000n)
		expect(e.flags).toBe(FPSR_DZC)
	})

	it('flushes denormals to zero under FZ', () => {
		let e = env(ROUND_TIEEVEN, FPCR_FZ)
		expect(fpAdd(s(2 ** -140), s(0), SINGLE, e)).toBe(0n)
		expect(e.flags).toBe(FPSR_IDC)
		e = env(ROUND_TIEEVEN, FPCR_FZ)
		expect(fpMul(s(2 ** -100), s(2 ** -30), SINGLE, e)).toBe(0n)
		expect(e.flags).toBe(FPSR_UFC)
	})

	it('propagates NaNs: signalling first, quietened, or the default NaN', () => {
		let e = env()
		expect(fpAdd(0x7FC00001n, 0x7F800002n, SINGLE, e)).toBe(0x7FC00002n)
		expect(e.flags).toBe(FPSR_IOC)
		e = env()
		expect(fpAdd(0xFFC00001n, 0x7FC00002n, SINGLE, e)).toBe(0xFFC00001n)
		expect(e.flags).toBe(0)
		e = env(ROUND_TIEEVEN, FPCR_DN)
		expect(fpAdd(0xFFC00001n, s(1), SINGLE, e)).toBe(0x7FC00000n)
		e = env()
		expect(fpMul(s(Infinity), s(0), SINGLE, e)).toBe(0x7FC00000n)
		expect(e.flags).toBe(FPSR_IOC)
		e = env()
		expect(fpSqrt(d(-1), DOUBLE, e)).toBe(0x7FF8000000000000n)
		// A quiet NaN addend with 0 * inf is invalid too.
		e = env()
		expect(fpMulAdd(0x7FC00001n, s(0), s(Infinity), SINGLE, e)).toBe(0x7FC00000n)
		expect(e.flags).toBe(FPSR_IOC)
	})

	it('tells FMAX from FMAXNM', () => {
		const qnan = 0x7FC00001n
		expect(fpMinMax(qnan, s(1), true, false, SINGLE, env())).toBe(qnan)
		expect(fpMinMax(qnan, s(1), true, true, SINGLE, env())).toBe(s(1))
		expect(fpMinMax(s(1), qnan, false, true, SINGLE, env())).toBe(s(1))
		const e = env()
		expect(fpMinMax(qnan, 0x7F800001n, true, true, SINGLE, e)).toBe(0x7FC00001n)
		expect(e.flags).toBe(FPSR_IOC)
		expect(fpMinMax(s(0), s(-0), true, false, SINGLE, env())).toBe(0n)
		expect(fpMinMax(s(0), s(-0), false, false, SINGLE, env())).toBe(0x80000000n)
	})

	it('fuses multiply-add into one rounding', () => {
		const a = 1 + 2 ** -30
		// a * a - 1 is 2^-29 + 2^-60, which two roundings lose.
		expect(fpMulAdd(d(-1), d(a), d(a), DOUBLE, env())).toBe(d(2 ** -29 + 2 ** -60))
		expect(fpAdd(fpMul(d(a), d(a), DOUBLE, env()), d(-1), DOUBLE, env())).toBe(d(2 ** -29))
	})

	it('converts to integers with rounding and saturation', () => {
		const cases: [number, number, boolean, bigint, number][] = [
			[2.5, ROUND_TIEEVEN, false, 2n, FPSR_IXC], [2.5, ROUND_TIEAWAY, false, 3n, FPSR_IXC], [-2.5, ROUND_TIEAWAY, false, -3n, FPSR_IXC],
			[-1.5, ROUND_ZERO, false, -1n, FPSR_IXC], [-1.5, ROUND_NEGINF, false, -2n, FPSR_IXC], [1.25, ROUND_POSINF, false, 2n, FPSR_IXC],
			[3e9, ROUND_ZERO, false, 0x7FFFFFFFn, FPSR_IOC], [-3e9, ROUND_ZERO, false, -0x80000000n, FPSR_IOC], [-1, ROUND_ZERO, true, 0n, FPSR_IOC],
			[3e9, ROUND_ZERO, true, 3000000000n, 0], [7, ROUND_ZERO, false, 7n, 0],
		]
		for (const [value, mode, unsigned, expected, flags] of cases) {
			const e = env()
			expect(fpToFixed(d(value), 0, unsigned, mode, 32, DOUBLE, e), `${value}`).toBe(BigInt.asUintN(32, expected))
			expect(e.flags, `${value}`).toBe(flags)
		}
		const e = env()
		expect(fpToFixed(0x7FC00000n, 0, false, ROUND_ZERO, 64, SINGLE, e)).toBe(0n)
		expect(e.flags).toBe(FPSR_IOC)
		// Fixed point: 1.75 with 4 fraction bits is 28.
		expect(fpToFixed(s(1.75), 4, false, ROUND_ZERO, 32, SINGLE, env())).toBe(28n)
		expect(fixedToFp(28n, 4, SINGLE, env())).toBe(s(1.75))
		expect(fixedToFp(-3n, 0, DOUBLE, env())).toBe(d(-3))
		// 2^24 + 1 is inexact in single.
		const i = env()
		expect(fixedToFp(16777217n, 0, SINGLE, i)).toBe(s(16777216))
		expect(i.flags).toBe(FPSR_IXC)
	})

	it('rounds to integral values', () => {
		expect(fpRoundInt(d(-0.4), ROUND_TIEEVEN, false, DOUBLE, env())).toBe(d(-0))
		expect(fpRoundInt(d(2.5), ROUND_TIEEVEN, false, DOUBLE, env())).toBe(d(2))
		expect(fpRoundInt(d(2.5), ROUND_TIEAWAY, false, DOUBLE, env())).toBe(d(3))
		expect(fpRoundInt(d(-2.1), ROUND_NEGINF, false, DOUBLE, env())).toBe(d(-3))
		const e = env()
		expect(fpRoundInt(d(2.1), ROUND_POSINF, true, DOUBLE, e)).toBe(d(3))
		expect(e.flags).toBe(FPSR_IXC)
	})

	it('compares, ordered and not', () => {
		expect(fpCompare(s(1), s(2), false, SINGLE, env())).toBe(0b1000)
		expect(fpCompare(s(2), s(2), false, SINGLE, env())).toBe(0b0110)
		expect(fpCompare(s(0), s(-0), false, SINGLE, env())).toBe(0b0110)
		expect(fpCompare(s(3), s(2), false, SINGLE, env())).toBe(0b0010)
		let e = env()
		expect(fpCompare(0x7FC00000n, s(2), false, SINGLE, e)).toBe(0b0011)
		expect(e.flags).toBe(0)
		e = env()
		fpCompare(0x7FC00000n, s(2), true, SINGLE, e)
		expect(e.flags).toBe(FPSR_IOC)
	})

	it('converts between single and double', () => {
		expect(fpConvert(s(1.5), SINGLE, DOUBLE, env())).toBe(d(1.5))
		const e = env()
		expect(fpConvert(d(0.1), DOUBLE, SINGLE, e)).toBe(s(0.1))
		expect(e.flags).toBe(FPSR_IXC)
		expect(fpConvert(0x7FC00001n, SINGLE, DOUBLE, env())).toBe(0x7FF8000020000000n)
	})

	it('expands 8-bit immediates', () => {
		expect(expandImm8(0x70, SINGLE)).toBe(0x3F800000n)
		expect(expandImm8(0x00, DOUBLE)).toBe(0x4000000000000000n)
		expect(expandImm8(0xF8, SINGLE)).toBe(s(-1.5))
		expect(encodeImm8(s(0.125), SINGLE)).toBe(0x40)
		expect(encodeImm8(s(0.1), SINGLE)).toBe(-1)
	})
})
