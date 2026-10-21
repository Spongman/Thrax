/**
 * Shadow call stack: CALL, a taken conditional CALL, RST and an accepted
 * interrupt push a frame; a RET, RETI or RETN that lands on a frame's return
 * address pops back to it, dropping any frames above. A return that reaches no
 * frame, such as one into a computed address, changes nothing.
 *
 * Frames are four numbers in one Int32Array. A pop only lowers the depth, so
 * the sink sees every change as an old number or an old depth, enough to undo.
 */

import { FrameStack, type FrameStackSink } from '../../core/frameStack'
export type Z80CallStackSink = FrameStackSink

export interface Z80Frame {
	/** Address of the CALL or RST, or of the instruction an interrupt came before. */
	callSite: number
	returnAddress: number
	callee: number
	/** SP once the return address was pushed. */
	stackPointer: number
}

const CALL_SITE = 0
const RETURN = 1
const CALLEE = 2
const SP = 3
const WIDTH = 4

export class Z80CallStack extends FrameStack {
	constructor() { super(WIDTH, Int32Array) }

	push(callSite: number, returnAddress: number, callee: number, sp: number) {
		const base = this.allocateFrame()
		this.write(base + CALL_SITE, callSite)
		this.write(base + RETURN, returnAddress)
		this.write(base + CALLEE, callee)
		this.write(base + SP, sp)
		this.changeDepth(this.count + 1)
	}

	/** A return to `target`: back to the innermost frame returning there, if any. */
	returnTo(target: number) {
		this.popTo(target, RETURN)
	}

	/** The frames, outermost first. */
	frames(): Z80Frame[] {
		const frames: Z80Frame[] = []
		for (let index = 0; index < this.count; index++) {
			const base = index * WIDTH
			frames.push({
				callSite: this.words[base + CALL_SITE],
				returnAddress: this.words[base + RETURN],
				callee: this.words[base + CALLEE],
				stackPointer: this.words[base + SP],
			})
		}
		return frames
	}

}
