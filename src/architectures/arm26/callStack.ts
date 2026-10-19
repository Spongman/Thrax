/**
 * Shadow call stack: a BL that runs is a call; any other instruction that
 * lands on a frame's return address (MOV PC, LR; MOVS PC, LR; LDMFD SP!,
 * {..., PC}) returns to the innermost such frame, dropping any above it.
 *
 * Frames are three words in one Int32Array. A pop only lowers the depth, so
 * the sink sees every change as an old word or an old depth, enough to undo.
 */

import { PC_MASK } from './cpu'

export interface Arm26CallStackSink {
	frameWord(index: number, old: number): void
	depth(old: number): void
}

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

export class Arm26CallStack {
	sink: Arm26CallStackSink | null = null
	private count = 0
	private words = new Int32Array(64 * WIDTH)

	get depth(): number {
		return this.count
	}

	setDepth(depth: number) {
		this.count = depth
	}

	setFrameWord(index: number, value: number) {
		this.words[index] = value
	}

	clear() {
		this.count = 0
	}

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
		for (let index = this.count - 1; index >= 0; index--) {
			if (this.words[index * WIDTH + RETURN] === next) {
				this.sink?.depth(this.count)
				this.count = index
				return
			}
		}
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
		const base = this.count * WIDTH
		if (base + WIDTH > this.words.length) {
			const grown = new Int32Array(this.words.length * 2)
			grown.set(this.words)
			this.words = grown
		}
		this.write(base + RETURN, (pc + 4) & PC_MASK)
		this.write(base + CALLEE, next)
		this.write(base + SP, sp)
		this.sink?.depth(this.count)
		this.count += 1
	}

	private write(index: number, value: number) {
		this.sink?.frameWord(index, this.words[index])
		this.words[index] = value
	}
}
