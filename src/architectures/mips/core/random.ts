/**
 * Pseudo-random streams for syscalls 40-44.
 *
 * One stream per identifier, so a program that seeds a stream gets the same
 * sequence on every run: a 48-bit linear congruential engine.
 */

import type { RandomSnapshot } from './types'

const MULTIPLIER = 0x5deece66dn
const ADDEND = 0xbn
const MASK = (1n << 48n) - 1n

export class JavaRandom {
	private seed: bigint

	constructor(seed?: number) {
		this.seed = 0n
		this.setSeed(seed ?? Date.now())
	}

	setSeed(seed: number) {
		this.seed = (BigInt.asUintN(64, BigInt(Math.trunc(seed))) ^ MULTIPLIER) & MASK
	}

	/** The top `bits` bits of the next state, as Java's `next(int)` returns them. */
	private next(bits: number): number {
		this.seed = (this.seed * MULTIPLIER + ADDEND) & MASK
		return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)))
	}

	nextInt(): number {
		return this.next(32)
	}

	/** A value in [0, bound), rejecting the values that would skew the range. */
	nextIntBounded(bound: number): number {
		if (bound <= 0) throw new Error(`Random bound (${bound}) must be positive`)
		if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n)

		for (;;) {
			const bits = this.next(31)
			const value = bits % bound
			// Retry when the final, short cycle of the range was drawn.
			if (bits - value + (bound - 1) >= 0) return value
		}
	}

	nextFloat(): number {
		return this.next(24) / (1 << 24)
	}

	nextDouble(): number {
		return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992
	}

	/** The engine's whole state, which is its 48-bit seed. */
	state(): bigint {
		return this.seed
	}

	setState(state: bigint) {
		this.seed = state & MASK
	}
}

/** The set of named streams a program has used, created on first reference. */
export class RandomStreams {
	private streams = new Map<number, JavaRandom>()

	stream(id: number): JavaRandom {
		let stream = this.streams.get(id)
		if (!stream) {
			stream = new JavaRandom()
			this.streams.set(id, stream)
		}
		return stream
	}

	setSeed(id: number, seed: number) {
		this.stream(id).setSeed(seed)
	}

	/**
	 * Every stream's engine state, so a backstep can put it back and a replayed
	 * draw returns what it returned the first time (bug 14).
	 */
	snapshot(): RandomSnapshot {
		return { streams: [...this.streams].map(([id, stream]) => ({ id, seed: stream.state().toString() })) }
	}

	/** Puts back a `snapshot`, dropping streams created since it was taken. */
	restore(snapshot: RandomSnapshot) {
		this.streams = new Map(snapshot.streams.map(({ id, seed }) => {
			const stream = new JavaRandom()
			stream.setState(BigInt(seed))
			return [id, stream]
		}))
	}
}
