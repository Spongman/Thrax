/**
 * Shadow call stack: JSR pushes a frame, and once the stack pointer rises back
 * to where it stood before a frame's JSR, by RTS or by pulling the return
 * address off by hand, that frame is gone.
 *
 * Frames are three words in one Int32Array. A pop only lowers the depth, so
 * the sink sees every change as an old word or an old depth, enough to undo.
 */

import { FrameStack, type FrameStackSink } from '../../core/frameStack'
import { JSR, OPCODE_INSN, PLA, PLP, RTI, RTS, TXS } from './isa'

export type Mos6502CallStackSink = FrameStackSink

export interface Mos6502Frame {
	/** Address of the JSR. */
	callSite: number
	/** Where RTS goes back to. */
	returnAddress: number
	callee: number
	/** SP before the JSR pushed its return address. */
	stackPointer: number
}

const SITE = 0
const CALLEE = 1
const SP = 2
const WIDTH = 3

/** Instructions that raise SP, after which frames may have been unwound. */
const UNWINDS = new Set([RTS, RTI, PLA, PLP, TXS])

export class Mos6502CallStack extends FrameStack {
	constructor() { super(WIDTH, Int32Array) }

	/** Updates the stack after `opcode` at `pc` ran, leaving PC at `next` and SP at `sp`. Allocates nothing. */
	observe(opcode: number, pc: number, next: number, sp: number) {
		const insn = OPCODE_INSN[opcode]
		if (insn === JSR) {
			// SP before the two bytes JSR pushed.
			this.push(pc, next, (sp + 2) & 0xFF)
			return
		}
		if (!UNWINDS.has(insn)) return
		let count = this.count
		while (count > 0 && this.words[(count - 1) * WIDTH + SP] <= sp) count--
		if (count === this.count) return
		this.changeDepth(count)
	}

	/** The frames, outermost first. */
	frames(): Mos6502Frame[] {
		const frames: Mos6502Frame[] = []
		for (let index = 0; index < this.count; index++) {
			const base = index * WIDTH
			const callSite = this.words[base + SITE]
			frames.push({ callSite, returnAddress: (callSite + 3) & 0xFFFF, callee: this.words[base + CALLEE], stackPointer: this.words[base + SP] })
		}
		return frames
	}

	private push(pc: number, callee: number, sp: number) {
		const base = this.allocateFrame()
		this.write(base + SITE, pc)
		this.write(base + CALLEE, callee)
		this.write(base + SP, sp)
		this.changeDepth(this.count + 1)
	}

}
