/**
 * Shadow call stack for A32: a BL or BLX that runs is a call, leaving the
 * return address in LR. Any other instruction that lands on a frame's return
 * address (BX LR, POP {..., PC}, MOV PC, LR) returns to the innermost such
 * frame, dropping any above it.
 *
 * Frames are three numbers in one Float64Array. A pop only lowers the depth,
 * so the sink sees every change as an old word or an old depth, enough to undo.
 */

import { FrameStack, type FrameStackSink } from '../../../core/frameStack'
export type A32CallStackSink = FrameStackSink

export interface A32Frame {
	/** Address of the BL or BLX. */
	callSite: number
	returnAddress: number
	callee: number
	/** SP at the call. */
	stackPointer: number
}

const RETURN = 0
const CALLEE = 1
const SP = 2
const WIDTH = 3

export class A32CallStack extends FrameStack {
	constructor() { super(WIDTH, Float64Array) }

	/** After the instruction at `pc` ran and left the PC at `next`: `call` when it was a BL or BLX that ran. Allocates nothing. */
	observe(call: boolean, pc: number, next: number, sp: number) {
		if (call) {
			this.push(pc, next, sp)
			return
		}
		if (next === pc + 4) return
		this.popTo(next, RETURN)
	}

	/** The frames, outermost first. */
	frames(): A32Frame[] {
		const frames: A32Frame[] = []
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

}
