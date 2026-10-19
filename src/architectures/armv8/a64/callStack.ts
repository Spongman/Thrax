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

import { Op, type A64Instruction } from './decode'

export interface A64CallStackSink {
	/** `index` is a word of the frame array, about to be overwritten. */
	frameWord(index: number, old: number): void
	depth(old: number): void
}

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

export class A64CallStack {
	sink: A64CallStackSink | null = null
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

	private pop(next: number) {
		for (let index = this.count - 1; index >= 0; index--) {
			if (this.words[index * WIDTH + RETURN] === next) {
				this.sink?.depth(this.count)
				this.count = index
				return
			}
		}
	}

	private write(index: number, value: number) {
		this.sink?.frameWord(index, this.words[index])
		this.words[index] = value
	}
}
