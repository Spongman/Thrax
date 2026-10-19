import { Op, type Arithmetic } from '../../../core/assembly/expressions'
import { AssemblyError } from '../../../core/diagnostics'
import { Z80Op } from './encoder'

const { Add, Sub, Mul, Div, Mod, And, Or, Xor, Shl, Shr, Neg, Not, Plus } = Op

/**
 * 32-bit signed integer arithmetic, as zasm and sjasmplus evaluate; a
 * comparison or logical operator gives 1 or 0.
 */
export const z80Arithmetic: Arithmetic = {
	unary(op, value) {
		switch (op) {
			case Neg: return -value | 0
			case Not: return ~value
			case Plus: return value
			case Z80Op.LogicalNot: return value === 0 ? 1 : 0
		}
		throw new Error(`Unsupported unary operator ${op}`)
	},
	binary(op, left, right, at) {
		switch (op) {
			case Add: return (left + right) | 0
			case Sub: return (left - right) | 0
			case Mul: return Math.imul(left, right)
			case Div:
				if (right === 0) throw new AssemblyError('Division by zero', at)
				return (left / right) | 0
			case Mod:
				if (right === 0) throw new AssemblyError('Modulo by zero', at)
				return (left % right) | 0
			case And: return left & right
			case Or: return left | right
			case Xor: return left ^ right
			case Shl: return left << right
			case Shr: return left >> right
			case Z80Op.Eq: return left === right ? 1 : 0
			case Z80Op.Ne: return left !== right ? 1 : 0
			case Z80Op.Lt: return left < right ? 1 : 0
			case Z80Op.Gt: return left > right ? 1 : 0
			case Z80Op.Le: return left <= right ? 1 : 0
			case Z80Op.Ge: return left >= right ? 1 : 0
			case Z80Op.LogicalAnd: return left !== 0 && right !== 0 ? 1 : 0
			case Z80Op.LogicalOr: return left !== 0 || right !== 0 ? 1 : 0
		}
		throw new Error(`Unsupported binary operator ${op}`)
	},
}
