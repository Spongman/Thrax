import { AssemblyError } from '../diagnostics'
import { Op, type Arithmetic } from './expressions'

/** Number arithmetic with 32-bit bitwise operations. Dialects retain precedence,
 * extensions, range checks and any arithmetic with different overflow rules. */
export const integerArithmetic: Arithmetic = {
	unary(op, value) {
		switch (op) {
			case Op.Neg: return -value
			case Op.Not: return ~value
			case Op.Plus: return value
			default: throw new Error(`Unsupported unary operator ${op}`)
		}
	},
	binary(op, a, b, at) {
		switch (op) {
			case Op.Add: return a + b
			case Op.Sub: return a - b
			case Op.Mul: return a * b
			case Op.Div:
				if (!b) throw new AssemblyError('Division by zero', at)
				return Math.trunc(a / b)
			case Op.Mod:
				if (!b) throw new AssemblyError('Division by zero', at)
				return a % b
			case Op.And: return a & b
			case Op.Or: return a | b
			case Op.Xor: return a ^ b
			case Op.Shl: return a << b
			case Op.Shr: return a >>> b
			case Op.Sar: return a >> b
			default: throw new AssemblyError('Unsupported operator', at)
		}
	},
}
