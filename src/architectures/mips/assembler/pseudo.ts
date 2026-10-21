/**
 * MARS pseudo-instruction lowering: each extended form becomes the basic
 * instructions it stands for, choosing the shortest sequence its constant
 * operands allow.  Expansion never depends on a label's value, so sizes are
 * known before layout.
 */

import { fpRegisterNumber } from '../core/coprocessor'
import { REGISTER_NAMES, registerNumber } from '../core/registers'
import { doubleToBits, singleToBits } from '../../../core/ieee754'
import { AssemblyError, atInstruction } from '../../../core/diagnostics'
import type { ImmediateArgument, LabelArgument, MipsArgument, MipsInstruction } from '../core/types'
import { highHalf, lowHalf, TWO_OPERAND_FORMS } from './operands'

export interface ExpansionSettings {
	/** Branches the pseudo-ops emit skip a delay slot of their own. */
	delayedBranching: boolean
	/**
	 * `lui` instructions whose label half is the high half of a load or store
	 * address, and so carries the bit-15 adjustment.  `la` resolves with `ori`
	 * and must not.
	 */
	adjustedHighHalves: Set<MipsInstruction>
}

export function expandInstruction(instruction: MipsInstruction, settings: ExpansionSettings): MipsInstruction[] {
	const make = (name: string, args: MipsArgument[]): MipsInstruction => ({
		name,
		args,
		labels: [],
		address: null,
		sourceLine: instruction.sourceLine,
		sourceColumn: instruction.sourceColumn,
	})
	const reg = (value: string): MipsArgument => ({ type: 'register', value })
	const immediate = (value: number): MipsArgument => ({ type: 'immediate', value })
	const memory = (offset: number, register: string): MipsArgument =>
		({ type: 'memory', offset: { type: 'immediate', value: offset }, register })
	// The three-operand arithmetic and logical instructions also take a
	// two-operand form, where the destination is also the first source.
	const [first, second, third] = TWO_OPERAND_FORMS.has(instruction.name) && instruction.args.length === 2
		? [instruction.args[0], instruction.args[0], instruction.args[1]]
		: instruction.args
	/** Materializes a full 32-bit word in `$at`, for the `li.s`/`li.d` bit patterns. */
	const loadAt = (bits: number): MipsInstruction[] => [
		make('LUI', [reg('$at'), immediate(bits >>> 16)]),
		make('ORI', [reg('$at'), reg('$at'), immediate(bits & 0xffff)]),
	]
	const isImmediate = (arg: MipsArgument | undefined): arg is ImmediateArgument =>
		typeof arg === 'object' && arg?.type === 'immediate'
	const fitsSigned16 = (value: number) => value >= -0x8000 && value <= 0x7fff
	const fitsUnsigned16 = (value: number) => value >= 0 && value <= 0xffff
	/**
	 * Puts `value` in `$at`, in one instruction when it fits the immediate
	 * field.
	 */
	const valueInAt = (value: number): MipsInstruction[] =>
		fitsSigned16(value)
			? [make('ADDI', [reg('$at'), reg('$zero'), immediate(value)])]
			: loadAt(value >>> 0)
	/**
	 * `op rd, rs, imm`.  The immediate folds into the I-type form when
	 * one exists and the value fits its field, and otherwise routes the value
	 * through `$at` and uses the register form.
	 */
	const withImmediate = (
		registerOp: string,
		immediateOp: string | null,
		unsigned: boolean,
		destination: MipsArgument,
		source: MipsArgument,
		operand: MipsArgument,
	): MipsInstruction[] => {
		if (!isImmediate(operand)) return [make(registerOp, [destination, source, operand])]
		const fits = unsigned ? fitsUnsigned16(operand.value) : fitsSigned16(operand.value)
		if (immediateOp && fits) return [make(immediateOp, [destination, source, operand])]
		return [...valueInAt(operand.value), make(registerOp, [destination, source, reg('$at')])]
	}
	/**
	 * Presents `arg` as a register, materializing a constant into `$at` first.
	 * The set and branch pseudo-ops are written against registers, so this is
	 * how a constant stands in one of their operand positions.
	 */
	const materialize = (arg: MipsArgument): { setup: MipsInstruction[]; operand: MipsArgument } =>
		isImmediate(arg) ? { setup: valueInAt(arg.value), operand: reg('$at') } : { setup: [], operand: arg }
	/** The constant the `set` pseudo-ops invert a comparison against. */
	const one = (): MipsInstruction[] => [make('ORI', [reg('$at'), reg('$zero'), immediate(1)])]
	/**
	 * A branch over `body`, which the checked pseudo-ops use to skip a
	 * `break`.  The offset is in words and counts the delay slot when there
	 * is one, which the expansion table spells `BROFFnm`.
	 */
	const skipping = (branch: MipsInstruction, body: MipsInstruction[]): MipsInstruction[] => {
		const delaySlot = settings.delayedBranching ? [make('NOP', [])] : []
		branch.args.push(immediate(delaySlot.length + body.length))
		return [branch, ...delaySlot, ...body]
	}
	/**
	 * `div`/`rem` in their three-operand form: divide, then take a result.
	 * A register divisor is checked against zero first;
	 * a constant one is known (`:226`).
	 */
	const divideInto = (divide: string, take: string): MipsInstruction[] => {
		if (!isImmediate(third)) {
			return [
				...skipping(make('BNE', [third, reg('$zero')]), [make('BREAK', [])]),
				make(divide, [second, third]),
				make(take, [first]),
			]
		}
		return [...valueInAt(third.value), make(divide, [second, reg('$at')]), make(take, [first])]
	}
	/** Rotate by assembling the two halves of the shift and merging them. */
	const rotate = (towardsHigh: string, towardsLow: string): MipsInstruction[] => {
		if (isImmediate(third)) {
			const places = third.value & 31
			return [
				make(towardsLow, [reg('$at'), second, immediate((32 - places) & 31)]),
				make(towardsHigh, [first, second, immediate(places)]),
				make('OR', [first, first, reg('$at')]),
			]
		}
		return [
			make('SUBU', [reg('$at'), reg('$zero'), third]),
			make(`${towardsLow}V`, [reg('$at'), second, reg('$at')]),
			make(`${towardsHigh}V`, [first, second, third]),
			make('OR', [first, first, reg('$at')]),
		]
	}
	/** The register one past `arg`, which the doubleword forms pair with. */
	const nextRegister = (arg: MipsArgument): MipsArgument => {
		if (typeof arg !== 'object' || arg.type !== 'register') throw new AssemblyError('Expected a register', atInstruction(instruction))
		const number = registerNumber(arg.value)
		if (number === null) return { type: 'register', value: `$f${fpRegisterNumber(arg.value) + 1}` }
		return reg(REGISTER_NAMES[(number + 1) % 32])
	}
	/**
	 * A load/store target as an offset(base) operand, `delta` bytes on.
	 *
	 * Every extended address form in has the same
	 * shape: the high half of the address goes in `$at`, the base register is
	 * added to it when there is one, and the low half stays in the
	 * instruction's own offset field.  The high half carries a 1 when bit 15
	 * of the address is set, since the low half is added back signed
	 *.
	 *
	 * The unaligned transfers touch one address several times and clobber
	 * `$at` in between, so the setup is re-emitted per access rather than
	 * kept.
	 */
	const addressParts = (target: MipsArgument, delta: number): { setup: MipsInstruction[]; operand: MipsArgument } => {
		const addBase = (base?: string) => (base ? [make('ADDU', [reg('$at'), reg('$at'), reg(base)])] : [])
		/** `lui $at, high; op rt, low($at)`, the general form. */
		const split = (value: number, base?: string) => ({
			setup: [make('LUI', [reg('$at'), immediate(highHalf(value))]), ...addBase(base)],
			operand: memory(lowHalf(value), '$at'),
		})
		/** The same for a label, whose halves are only known after layout. */
		const splitLabel = (label: LabelArgument, base?: string) => {
			const shifted: LabelArgument = { ...label, offset: (label.offset ?? 0) + delta }
			const lui = make('LUI', [reg('$at'), shifted])
			settings.adjustedHighHalves.add(lui)
			const operand: MipsArgument = { type: 'memory', offset: shifted, register: '$at' }
			return { setup: [lui, ...addBase(base)], operand }
		}
		/** A 16-bit unsigned address needs no `lui`. */
		const throughOri = (value: number, base?: string) => ({
			setup: [make('ORI', [reg('$at'), reg('$zero'), immediate(value)]), ...addBase(base)],
			operand: memory(0, '$at'),
		})
		const value = (amount: number, base?: string) => {
			if (delta === 0 && !base && fitsSigned16(amount)) return { setup: [], operand: memory(amount, '$zero') }
			if (delta === 0 && fitsUnsigned16(amount)) return throughOri(amount, base)
			return split(amount + delta, base)
		}

		if (typeof target === 'object' && target.type === 'memory') {
			if (target.offset.type === 'label') return splitLabel(target.offset, target.register)
			const offset = target.offset.value
			// An offset the field already holds stays there, and so do the
			// three bytes past a `($t2)` operand.
			if (fitsSigned16(offset) && (delta === 0 || offset === 0)) {
				return { setup: [], operand: memory(offset + delta, target.register) }
			}
			return value(offset, target.register)
		}
		if (isImmediate(target)) return value(target.value)
		if (typeof target === 'object' && target.type === 'label') return splitLabel(target)
		throw new AssemblyError(`${instruction.name} needs an address operand`, atInstruction(instruction))
	}
	/** `ld`/`sd` move a register pair to or from two consecutive words. */
	const doubleword = (transfer: string): MipsInstruction[] => {
		const start = addressParts(second, 0)
		const next = addressParts(second, 4)
		return [
			...start.setup, make(transfer, [first, start.operand]),
			...next.setup, make(transfer, [nextRegister(first), next.operand]),
		]
	}
	/** `ulw`/`usw`: the halves of a word that straddles an alignment boundary. */
	const unalignedWord = (high: string, low: string): MipsInstruction[] => {
		const end = addressParts(second, 3)
		const start = addressParts(second, 0)
		return [...end.setup, make(high, [first, end.operand]), ...start.setup, make(low, [first, start.operand])]
	}
	/** `ulh`/`ulhu`: two bytes, the upper one carrying the sign when signed. */
	const unalignedHalf = (loadHigh: string): MipsInstruction[] => {
		const high = addressParts(second, 1)
		const low = addressParts(second, 0)
		return [
			...high.setup, make(loadHigh, [first, high.operand]),
			...low.setup, make('LBU', [reg('$at'), low.operand]),
			make('SLL', [first, first, immediate(8)]),
			make('OR', [first, first, reg('$at')]),
		]
	}
	/**
	 * `ush`: store two bytes.  Between them the source is rotated right by
	 * eight and back again, which brings the second byte into position
	 * without a scratch register beyond `$at`.
	 */
	const unalignedStoreHalf = (): MipsInstruction[] => {
		const low = addressParts(second, 0)
		const high = addressParts(second, 1)
		const rotate = (out: string, back: string): MipsInstruction[] => [
			make(out, [reg('$at'), first, immediate(24)]),
			make(back, [first, first, immediate(8)]),
			make('OR', [first, first, reg('$at')]),
		]
		return [
			...low.setup, make('SB', [first, low.operand]),
			...rotate('SLL', 'SRL'),
			...high.setup, make('SB', [first, high.operand]),
			...rotate('SRL', 'SLL'),
		]
	}
	/**
	 * `mulo`/`mulou`: multiply, then `break` when the product does not fit
	 * 32 bits.  The branch skips the delay slot too when it exists.
	 */
	const multiplyChecked = (multiply: string, overflowed: MipsInstruction[]): MipsInstruction[] => {
		const { setup, operand } = materialize(third)
		const delaySlot = settings.delayedBranching ? [make('NOP', [])] : []
		return [
			...setup,
			make(multiply, [second, operand]),
			make('MFHI', [reg('$at')]),
			...overflowed,
			make('BEQ', [reg('$at'), overflowed.length > 0 ? first : reg('$zero'), immediate(delaySlot.length + 1)]),
			...delaySlot,
			make('BREAK', []),
			make('MFLO', [first]),
		]
	}
	/** One load or store, with whatever it takes to reach its address. */
	const transfer = (name: string): MipsInstruction[] => {
		const { setup, operand } = addressParts(second, 0)
		return [...setup, make(name, [first, operand])]
	}
	/**
	 * `la`, which computes an address rather than using one.  Its low half is
	 * added back by `ori`, unsigned, so its high half never carries the bit-15
	 * adjustment a load's does.
	 */
	const loadAddress = (): MipsInstruction[] => {
		const based = typeof second === 'object' && second.type === 'memory'
		const base = based ? (second as { register: string }).register : null
		const target = based ? (second as { offset: MipsArgument }).offset : second
		// With a base register the halves land in $at and are added to it.
		const destination = base ? reg('$at') : first
		const withBase = (built: MipsInstruction[]) =>
			base ? [...built, make('ADD', [first, reg(base), reg('$at')])] : built
		if (isImmediate(target)) {
			// `la $t1,($t2)` is the base register itself.
			if (base && target.value === 0) return [make('ADDI', [first, reg(base), immediate(0)])]
			if (!base && fitsSigned16(target.value)) return [make('ADDIU', [first, reg('$zero'), target])]
			if (fitsUnsigned16(target.value)) return withBase([make('ORI', [destination, reg('$zero'), target])])
			return withBase([
				make('LUI', [reg('$at'), immediate(target.value >>> 16)]),
				make('ORI', [destination, reg('$at'), immediate(target.value & 0xffff)]),
			])
		}
		if (typeof target === 'object' && target.type === 'label') {
			return withBase([make('LUI', [reg('$at'), target]), make('ORI', [destination, reg('$at'), target])])
		}
		throw new AssemblyError('la needs an address operand', atInstruction(instruction))
	}

	switch (instruction.name) {
		case 'NOP': return [make('SLL', [reg('$zero'), reg('$zero'), immediate(0)])]
		case 'MOVE': return [make('ADDU', [first, reg('$zero'), second])]
		case 'LI': {
			if (second?.type !== 'immediate') throw new AssemblyError('li requires an immediate value', atInstruction(instruction))
			if (fitsSigned16(second.value)) return [make('ADDIU', [first, reg('$zero'), second])]
			if (fitsUnsigned16(second.value)) return [make('ORI', [first, reg('$zero'), second])]
			return [
				make('LUI', [reg('$at'), immediate(second.value >>> 16)]),
				make('ORI', [first, reg('$at'), immediate(second.value & 0xffff)]),
			]
		}
		case 'LA': return loadAddress()
		case 'B': return [make('BGEZ', [reg('$zero'), first])]
		case 'BAL': return [make('JAL', [first])]
		case 'BEQZ': return [make('BEQ', [first, reg('$zero'), second])]
		case 'BNEZ': return [make('BNE', [first, reg('$zero'), second])]
		case 'BLT':
		case 'BGE':
		case 'BLTU':
		case 'BGEU': {
			const unsigned = instruction.name.endsWith('U')
			const branch = instruction.name.startsWith('BLT') ? 'BNE' : 'BEQ'
			const test = isImmediate(second) && fitsSigned16(second.value)
				// A 16-bit constant compares in the `slti` field itself.
				? [make(unsigned ? 'SLTIU' : 'SLTI', [reg('$at'), first, second])]
				: (({ setup, operand }) => [...setup, make(unsigned ? 'SLTU' : 'SLT', [reg('$at'), first, operand])])(materialize(second))
			return [...test, make(branch, [reg('$at'), reg('$zero'), third])]
		}
		case 'BLEU':
		case 'BGTU': {
			const { setup, operand } = materialize(second)
			const branch = instruction.name === 'BGTU' ? 'BNE' : 'BEQ'
			return [...setup, make('SLTU', [reg('$at'), operand, first]), make(branch, [reg('$at'), reg('$zero'), third])]
		}
		// The signed pair compares the other way round for a 32-bit constant:
		// `x > c` is `!(x < c+1)`.
		case 'BLE':
		case 'BGT': {
			const greater = instruction.name === 'BGT'
			if (isImmediate(second) && !fitsSigned16(second.value)) {
				return [
					...loadAt((second.value + 1) >>> 0),
					make('SLT', [reg('$at'), first, reg('$at')]),
					make(greater ? 'BEQ' : 'BNE', [reg('$at'), reg('$zero'), third]),
				]
			}
			// `x <= c` is `x - 1 < c` for a 16-bit constant (`:214`).
			if (!greater && isImmediate(second)) {
				return [
					make('ADDI', [reg('$at'), first, immediate(-1)]),
					make('SLTI', [reg('$at'), reg('$at'), second]),
					make('BNE', [reg('$at'), reg('$zero'), third]),
				]
			}
			const { setup, operand } = materialize(second)
			return [...setup, make('SLT', [reg('$at'), operand, first]), make(greater ? 'BNE' : 'BEQ', [reg('$at'), reg('$zero'), third])]
		}
		case 'NOT': return [make('NOR', [first, second, reg('$zero')])]
		case 'NEG': return [make('SUB', [first, reg('$zero'), second])]
		case 'NEGU': return [make('SUBU', [first, reg('$zero'), second])]
		case 'ABS': return [
			make('SRA', [reg('$at'), second, immediate(31)]),
			make('XOR', [first, reg('$at'), second]),
			make('SUBU', [first, first, reg('$at')]),
		]
		case 'SEQ':
		case 'SNE': {
			const { setup, operand } = materialize(third)
			// The difference is zero exactly when the two are equal.
			const finish = instruction.name === 'SEQ'
				? [...one(), make('SLTU', [first, first, reg('$at')])]
				: [make('SLTU', [first, reg('$zero'), first])]
			return [...setup, make('SUBU', [first, second, operand]), ...finish]
		}
		case 'SGT':
		case 'SGTU': {
			const { setup, operand } = materialize(third)
			return [...setup, make(instruction.name === 'SGTU' ? 'SLTU' : 'SLT', [first, operand, second])]
		}
		case 'SGE':
		case 'SGEU':
		case 'SLE':
		case 'SLEU': {
			const { setup, operand } = materialize(third)
			const compare = instruction.name.endsWith('U') ? 'SLTU' : 'SLT'
			// `x >= y` is `!(x < y)`; `x <= y` is `!(y < x)`.
			const args = instruction.name.startsWith('SGE') ? [first, second, operand] : [first, operand, second]
			return [...setup, make(compare, args), ...one(), make('SUBU', [first, reg('$at'), first])]
		}
		case 'L.S': return transfer('LWC1')
		case 'L.D': return transfer('LDC1')
		case 'S.S': return transfer('SWC1')
		case 'S.D': return transfer('SDC1')
		case 'LWC1':
		case 'LDC1':
		case 'SWC1':
		case 'SDC1':
		case 'LW':
		case 'LH':
		case 'LHU':
		case 'LB':
		case 'LBU':
		case 'SW':
		case 'SH':
		case 'SB':
		case 'LL':
		case 'SC':
		case 'LWL':
		case 'LWR':
		case 'SWL':
		case 'SWR':
			return transfer(instruction.name)
		case 'ULW': return unalignedWord('LWL', 'LWR')
		case 'USW': return unalignedWord('SWL', 'SWR')
		case 'ULH': return unalignedHalf('LB')
		case 'ULHU': return unalignedHalf('LBU')
		case 'USH': return unalignedStoreHalf()
		// The signed form compares the high word against the sign of the low
		// one; the unsigned form only needs the high word to be zero.
		case 'MULO': return multiplyChecked('MULT', [make('MFLO', [first]), make('SRA', [first, first, immediate(31)])])
		case 'MULOU': return multiplyChecked('MULTU', [])
		case 'LI.S': {
			if (second?.type !== 'immediate') throw new AssemblyError('li.s requires an immediate value', atInstruction(instruction))
			return [...loadAt(singleToBits(second.value)), make('MTC1', [reg('$at'), first])]
		}
		case 'LI.D': {
			if (second?.type !== 'immediate') throw new AssemblyError('li.d requires an immediate value', atInstruction(instruction))
			if (first?.type !== 'register') throw new AssemblyError('li.d requires a floating-point register', atInstruction(instruction))
			const index = fpRegisterNumber(first.value)
			if (index % 2 !== 0) throw new AssemblyError(`li.d requires an even register, not ${first.value}`, atInstruction(instruction))
			const { low, high } = doubleToBits(second.value)
			return [
				...loadAt(low), make('MTC1', [reg('$at'), first]),
				...loadAt(high), make('MTC1', [reg('$at'), reg(`$f${index + 1}`)]),
			]
		}
		// Three-operand div/rem are pseudo-ops; the two-operand forms are real.
		case 'REM': return divideInto('DIV', 'MFHI')
		case 'REMU': return divideInto('DIVU', 'MFHI')
		case 'DIV': return instruction.args.length < 3 ? [instruction] : divideInto('DIV', 'MFLO')
		case 'DIVU': return instruction.args.length < 3 ? [instruction] : divideInto('DIVU', 'MFLO')
		case 'MULU': return [
			...(isImmediate(third) ? valueInAt(third.value) : []),
			make('MULTU', [second, isImmediate(third) ? reg('$at') : third]),
			make('MFLO', [first]),
		]

		// An immediate where a register belongs.  These are accepted and
		// widened; dropping the operand would assemble a wrong answer.
		case 'ADD': return withImmediate('ADD', 'ADDI', false, first, second, third)
		case 'ADDU': return withImmediate('ADDU', 'ADDIU', false, first, second, third)
		case 'ADDI': return withImmediate('ADD', 'ADDI', false, first, second, third)
		case 'ADDIU': return withImmediate('ADDU', 'ADDIU', false, first, second, third)
		case 'SUB':
		case 'SUBI': return withImmediate('SUB', null, false, first, second, third)
		case 'SUBU':
		case 'SUBIU': return withImmediate('SUBU', null, false, first, second, third)
		case 'AND': return withImmediate('AND', 'ANDI', true, first, second, third)
		case 'OR': return withImmediate('OR', 'ORI', true, first, second, third)
		case 'XOR': return withImmediate('XOR', 'XORI', true, first, second, third)
		case 'ANDI': return withImmediate('AND', 'ANDI', true, first, second, third)
		case 'ORI': return withImmediate('OR', 'ORI', true, first, second, third)
		case 'XORI': return withImmediate('XOR', 'XORI', true, first, second, third)
		case 'SLT': return withImmediate('SLT', 'SLTI', false, first, second, third)
		case 'SLTU': return withImmediate('SLTU', 'SLTIU', false, first, second, third)
		case 'SLTI': return withImmediate('SLT', 'SLTI', false, first, second, third)
		case 'SLTIU': return withImmediate('SLTU', 'SLTIU', false, first, second, third)
		case 'MUL': return withImmediate('MUL', null, false, first, second, third)

		// A branch may compare against a constant, which goes through $at.
		case 'BEQ':
		case 'BNE': {
			if (!isImmediate(second)) return [instruction]
			// The comparison is `$at` against the register, in that order
			//.
			return [...valueInAt(second.value), make(instruction.name, [reg('$at'), first, third])]
		}

		case 'ROL': return rotate('SLL', 'SRL')
		case 'ROR': return rotate('SRL', 'SLL')

		case 'LD': return doubleword('LW')
		case 'SD': return doubleword('SW')
		case 'MFC1.D': return [make('MFC1', [first, second]), make('MFC1', [nextRegister(first), nextRegister(second)])]
		case 'MTC1.D': return [make('MTC1', [first, second]), make('MTC1', [nextRegister(first), nextRegister(second)])]
		default: return [{ ...instruction, args: [...instruction.args], labels: [] }]
	}
}
