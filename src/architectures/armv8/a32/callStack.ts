/**
 * Shadow call stack for A32: a BL or BLX that runs is a call, leaving the
 * return address in LR. Any other instruction that lands on a frame's return
 * address (BX LR, POP {..., PC}, MOV PC, LR) returns to the innermost such
 * frame, dropping any above it.
 *
 * Frames are three numbers in one Float64Array. A pop only lowers the depth,
 * so the sink sees every change as an old word or an old depth, enough to undo.
 */

export interface A32CallStackSink {
	/** `index` is a word of the frame array, about to be overwritten. */
	frameWord(index: number, old: number): void
	depth(old: number): void
}

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

export class A32CallStack {
	sink: A32CallStackSink | null = null
	private count = 0
	private words = new Float64Array(64 * WIDTH)

	get depth(): number {
		return this.count
	}

	/** Restores the depth; for rewind, not recorded. */
	setDepth(depth: number) {
		this.count = depth
	}

	/** Restores one frame word; for rewind, not recorded. */
	setFrameWord(index: number, value: number) {
		this.words[index] = value
	}

	clear() {
		this.count = 0
	}

	/** After the instruction at `pc` ran and left the PC at `next`: `call` when it was a BL or BLX that ran. Allocates nothing. */
	observe(call: boolean, pc: number, next: number, sp: number) {
		if (call) {
			this.push(pc, next, sp)
			return
		}
		if (next === pc + 4) return
		for (let index = this.count - 1; index >= 0; index--) {
			if (this.words[index * WIDTH + RETURN] === next) {
				this.sink?.depth(this.count)
				this.count = index
				return
			}
		}
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
		const base = this.count * WIDTH
		if (base + WIDTH > this.words.length) {
			const grown = new Float64Array(this.words.length * 2)
			grown.set(this.words)
			this.words = grown
		}
		this.write(base + RETURN, pc + 4)
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
