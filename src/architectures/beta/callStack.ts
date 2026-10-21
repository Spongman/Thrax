/**
 * Shadow call stack, following the course convention (beta.pdf section 7):
 * CALL(label) = BR(label, LP), RTN() = JMP(LP), and a callee that sets up a
 * BP frame with PUSH(LP) PUSH(BP) MOVE(SP, BP), so its arguments sit at BP-12,
 * BP-16 and so on.
 *
 * Any taken branch or JMP that writes LP is a call. A JMP through LP returns
 * to the innermost frame whose return address it reaches, dropping any frames
 * above it; one that reaches no frame changes nothing.
 *
 * Frames are three words in one Int32Array. A pop only lowers the depth, so
 * the sink sees every change as an old word or an old depth, enough to undo.
 */

import { FrameStack, type FrameStackSink } from '../../core/frameStack'
import { OP_BEQ, OP_BNE, OP_JMP } from './isa'
import { R_LP } from './registers'

export type BetaCallStackSink = FrameStackSink

export interface BetaFrame {
	/** Address of the CALL. */
	callSite: number
	/** Where RTN goes back to, without the supervisor bit. */
	returnAddress: number
	/** The callee's entry. */
	callee: number
	/** Name of the callee entry, when the symbol table has one. */
	label: string | undefined
	/** SP at the call: the first word above the arguments. */
	stackPointer: number
	/** BP once the callee's prologue has run. */
	framePointer: number
}

const RETURN = 0
const CALLEE = 1
const SP = 2
const WIDTH = 3
const ADDRESS_MASK = 0x7FFFFFFC

export class BetaCallStack extends FrameStack {
	constructor() { super(WIDTH, Int32Array) }

	/** Index 0 is the outermost call. */
	returnAddress(index: number): number {
		return this.words[index * WIDTH + RETURN] >>> 0
	}

	callee(index: number): number {
		return this.words[index * WIDTH + CALLEE] >>> 0
	}

	stackPointer(index: number): number {
		return this.words[index * WIDTH + SP] >>> 0
	}

	/**
	 * Updates the stack after an instruction ran: `word` at `pc`, leaving the CPU
	 * at `next` with `sp` in SP. Allocates nothing.
	 */
	observe(word: number, pc: number, next: number, sp: number) {
		const opcode = word >>> 26
		const rc = (word >>> 21) & 31
		if (opcode === OP_JMP) {
			if (rc === R_LP) this.push(pc, next, sp)
			else if (((word >>> 16) & 31) === R_LP) this.pop(next)
		} else if ((opcode === OP_BEQ || opcode === OP_BNE) && rc === R_LP) {
			// Only a taken branch lands off the fall-through address.
			const target = (pc + 4 + ((word << 16) >> 16) * 4) & ADDRESS_MASK
			if ((next & ADDRESS_MASK) === target) this.push(pc, next, sp)
		}
	}

	/** The frames as objects, outermost first, for a view. */
	frames(symbolAt?: (address: number) => string | undefined): BetaFrame[] {
		const frames: BetaFrame[] = []
		for (let index = 0; index < this.count; index++) {
			const returnAddress = this.returnAddress(index)
			const callee = this.callee(index)
			const stackPointer = this.stackPointer(index)
			frames.push({
				callSite: (returnAddress - 4) >>> 0,
				returnAddress,
				callee,
				label: symbolAt?.(callee),
				stackPointer,
				framePointer: (stackPointer + 8) >>> 0,
			})
		}
		return frames
	}

	private push(pc: number, next: number, sp: number) {
		const base = this.allocateFrame()
		this.write(base + RETURN, (pc + 4) & ADDRESS_MASK)
		this.write(base + CALLEE, next & ADDRESS_MASK)
		this.write(base + SP, sp)
		this.changeDepth(this.count + 1)
	}

	private pop(next: number) {
		const target = next & ADDRESS_MASK
		this.popTo(target, RETURN)
	}

}
