/** Expression syntax and arithmetic of the two dialects, over 32-bit words. */

import { Op, type Arithmetic, type ExpressionSyntax } from '../../../../core/assembly/expressions'
import type { Position } from '../../../../core/assembly/tokens'
import { AssemblyError } from '../../../../core/diagnostics'

const { Add, Sub, Mul, Div, Mod, And, Or, Xor, Shl, Shr, Neg, Not, Plus } = Op

const binary = (entries: readonly [string, number, number][]) =>
	new Map(entries.map(([text, op, precedence]) => [text, { op, precedence }]))

/** C precedence, as GNU as reads ARM expressions closely enough. */
export const gnuExpressionSyntax: ExpressionSyntax = {
	binary: binary([
		['|', Or, 1], ['^', Xor, 2], ['&', And, 3], ['<<', Shl, 4], ['>>', Shr, 4],
		['+', Add, 5], ['-', Sub, 5], ['*', Mul, 6], ['/', Div, 6], ['%', Mod, 6],
	]),
	unary: new Map([['-', Neg], ['~', Not], ['+', Plus]]),
	dot: '.',
}

/** armasm's named operators, at the same levels. */
export const armasmExpressionSyntax: ExpressionSyntax = {
	binary: binary([
		[':or:', Or, 1], [':eor:', Xor, 2], [':and:', And, 3], [':shl:', Shl, 4], [':shr:', Shr, 4], ['<<', Shl, 4], ['>>', Shr, 4],
		['+', Add, 5], ['-', Sub, 5], ['*', Mul, 6], ['/', Div, 6], [':mod:', Mod, 6],
	]),
	unary: new Map([['-', Neg], [':not:', Not], ['+', Plus]]),
	dot: '.',
}

/** Wrapping 32-bit arithmetic; >> is logical, and dividing by zero is an error. */
export const armArithmetic: Arithmetic = {
	unary(op, value) {
		switch (op) {
			case Neg: return -value | 0
			case Not: return ~value
			case Plus: return value
		}
		throw new Error(`Unsupported unary operator ${op}`)
	},
	binary(op, left, right, at) {
		const a = left | 0
		const b = right | 0
		switch (op) {
			case Add: return (a + b) | 0
			case Sub: return (a - b) | 0
			case Mul: return Math.imul(a, b)
			case Div:
				if (b === 0) throw new AssemblyError('Division by zero', at)
				return (a / b) | 0
			case Mod:
				if (b === 0) throw new AssemblyError('Modulo by zero', at)
				return a % b
			case And: return a & b
			case Or: return a | b
			case Xor: return a ^ b
			case Shl: return b >>> 0 >= 32 ? 0 : a << b
			case Shr: return b >>> 0 >= 32 ? 0 : (a >>> b) | 0
		}
		throw new Error(`Unsupported binary operator ${op}`)
	},
}

/** A value checked to fit 32 bits, signed or unsigned, as an unsigned word. */
export function word32(value: number, at: Position): number {
	if (!Number.isInteger(value) || value < -(2 ** 31) || value >= 2 ** 32) throw new AssemblyError(`${value} does not fit in 32 bits`, at)
	return value >>> 0
}

/** Range check for a data value of `size` bytes; signed and unsigned readings both pass. */
export function checkDataValue(value: number, size: number, at: Position): number {
	if (size === 4) return word32(value, at)
	const bits = size * 8
	if (!Number.isInteger(value) || value < -(2 ** (bits - 1)) || value >= 2 ** bits) {
		throw new AssemblyError(`${value} does not fit in ${size === 1 ? 'a byte' : `${size} bytes`}`, at)
	}
	return value
}
