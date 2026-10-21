/** Two words already in the F/D/E pipeline, including delayed prefetch-abort markers. */
export class Arm26Prefetch {
	/** valid, execute address, execute word/abort, decode word/abort, next fetch S. */
	readonly words = new Uint32Array(7)
	/** Fetch start/end for each word, followed by their decode-entry times. */
	readonly times = new Float64Array(6)

	get ready() { return this.words[0] !== 0 }
	get address() { return this.words[1] }
	get instruction() { return this.words[2] | 0 }
	get aborted() { return this.words[3] !== 0 }
	get sequential() { return this.words[6] !== 0 }
	set sequential(value: boolean) { this.words[6] = +value }

	invalidate() {
		this.words[0] = 0
	}

	set(address: number, word: number, abort: boolean, start: number, end: number, second: boolean) {
		const slot = second ? 4 : 2
		this.words[slot] = word
		this.words[slot + 1] = +abort
		const time = second ? 2 : 0
		this.times[time] = start
		this.times[time + 1] = end
		if (second) {
			this.times[4] = this.times[1]
			this.times[5] = end
		}
		if (!second) {
			this.words[0] = 1
			this.words[1] = address
		}
		this.sequential = true
	}

	advance(address: number, word: number, abort: boolean, start: number, end: number, decodeStart: number) {
		this.words[1] = address
		this.words[2] = this.words[4]
		this.words[3] = this.words[5]
		this.times[0] = this.times[2]
		this.times[1] = this.times[3]
		this.words[4] = word
		this.words[5] = +abort
		this.times[2] = start
		this.times[3] = end
		this.times[4] = this.times[5]
		this.times[5] = decodeStart
	}
}
