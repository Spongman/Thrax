/**
 * Shadow call stack after the AAPCS64 calling convention: BL and BLR call,
 * leaving the return address in X30, and RET returns through a register,
 * X30 unless it names another.
 *
 * A RET returns to the innermost frame whose return address it reaches,
 * dropping any frames above it; one that reaches no frame changes nothing.
 * Frames are four numbers in one Float64Array. A pop only lowers the depth, so
 * the sink sees every change as an old word or an old depth, enough to undo.
 */

import { FrameStack, type FrameStackSink } from '../../../core/frameStack'
import { Op, type A64Instruction } from './decode'

export type A64CallStackSink = FrameStackSink

export interface A64Frame {
	/** Address of the BL or BLR. */
	callSite: number
	returnAddress: number
	/** The callee's entry. */
	callee: number
	/** SP at the call. */
	stackPointer: number
}

const RETURN = 0
const CALLEE = 1
const SP = 2
const WIDTH = 3

export class A64CallStack extends FrameStack {
	constructor() { super(WIDTH, Float64Array) }

	/**
	 * Updates the stack after `instruction` ran at `pc`, leaving the CPU at
	 * `next` with `sp` in SP. Allocates nothing.
	 */
	observe(instruction: A64Instruction, pc: number, next: number, sp: number) {
		switch (instruction.op) {
			case Op.BL: case Op.BLR: this.push(pc, next, sp); break
			case Op.RET: this.pop(next); break
		}
	}

	/** The frames, outermost first. */
	frames(): A64Frame[] {
		const frames: A64Frame[] = []
		for (let index = 0; index < this.count; index++) {
			const base = index * WIDTH
			const returnAddress = this.words[base + RETURN]
			frames.push({ callSite: returnAddress - 4, returnAddress, callee: this.words[base + CALLEE], stackPointer: this.words[base + SP] })
		}
		return frames
	}

	private push(pc: number, next: number, sp: number) {
		const base = this.allocateFrame()
		this.write(base + RETURN, pc + 4)
		this.write(base + CALLEE, next)
		this.write(base + SP, sp)
		this.changeDepth(this.count + 1)
	}

	private pop(next: number) {
		this.popTo(next, RETURN)
	}

}
