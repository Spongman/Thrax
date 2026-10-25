/**
 * Shadow call stack: a BL that runs is a call; any other instruction that
 * lands on a frame's return address (MOV PC, LR; MOVS PC, LR; LDMFD SP!,
 * {..., PC}) returns to the innermost such frame, dropping any above it.
 *
 * Frames are three words in one Int32Array. A pop only lowers the depth, so
 * the sink sees every change as an old word or an old depth, enough to undo.
 */

import { FrameStack, type FrameStackSink } from '../../../core/frameStack'
import { PC_MASK } from './cpu'

export type Arm26CallStackSink = FrameStackSink

export interface Arm26Frame {
	callSite: number
	returnAddress: number
	callee: number
	stackPointer: number
}

const RETURN = 0
const CALLEE = 1
const SP = 2
const WIDTH = 3

export class Arm26CallStack extends FrameStack {
	constructor() { super(WIDTH, Int32Array) }

	/**
	 * After an instruction at `pc` ran and left the PC at `next`: `call` when it
	 * was a BL that ran. Allocates nothing.
	 */
	observe(call: boolean, pc: number, next: number, sp: number) {
		if (call) {
			this.push(pc, next, sp)
			return
		}
		if (next === ((pc + 4) & PC_MASK)) return
		this.popTo(next, RETURN)
	}

	/** Outermost first. */
	frames(): Arm26Frame[] {
		const frames: Arm26Frame[] = []
		for (let index = 0; index < this.count; index++) {
			const returnAddress = this.words[index * WIDTH + RETURN] >>> 0
			frames.push({
				callSite: (returnAddress - 4) >>> 0,
				returnAddress,
				callee: this.words[index * WIDTH + CALLEE] >>> 0,
				stackPointer: this.words[index * WIDTH + SP] >>> 0,
			})
		}
		return frames
	}

	private push(pc: number, next: number, sp: number) {
		const base = this.allocateFrame()
		this.write(base + RETURN, (pc + 4) & PC_MASK)
		this.write(base + CALLEE, next)
		this.write(base + SP, sp)
		this.changeDepth(this.count + 1)
	}

}
