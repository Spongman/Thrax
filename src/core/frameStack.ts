/** Typed shadow-frame storage. ISA adapters own field layout and unwind detection. */
export interface FrameStackSink {
	frameWord(index: number, old: number): void
	depth(old: number): void
}

type FrameWords = Int32Array | Float64Array
type FrameArray = Int32ArrayConstructor | Float64ArrayConstructor

export class FrameStack {
	sink: FrameStackSink | null = null
	protected count = 0
	protected words: FrameWords

	constructor(private readonly width: number, private readonly array: FrameArray) {
		this.words = new array(64 * width)
	}

	get depth(): number { return this.count }

	/** Restore directly without recording a second history change. */
	setDepth(depth: number) { this.count = depth }
	frameWordAt(index: number): number { return this.words[index] }
	setFrameWord(index: number, value: number) { this.words[index] = value }
	clear() { this.count = 0 }

	protected allocateFrame(): number {
		const base = this.count * this.width
		if (base + this.width > this.words.length) {
			const grown = new this.array(this.words.length * 2)
			grown.set(this.words)
			this.words = grown
		}
		return base
	}

	protected write(index: number, value: number) {
		this.sink?.frameWord(index, this.words[index])
		this.words[index] = value
	}

	protected changeDepth(depth: number) {
		this.sink?.depth(this.count)
		this.count = depth
	}

	protected popTo(value: number, column: number) {
		for (let index = this.count - 1; index >= 0; index--) {
			if (this.words[index * this.width + column] !== value) continue
			this.changeDepth(index)
			return
		}
	}
}
