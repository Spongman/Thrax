import type { KeyboardDisplayDevice } from '../../architectures/contracts'

/** MARS's keyboard and display: a receiver to poll and a transmitter that is always ready. */
export class PolledTerminal {
	constructor(private readonly base: number) {}
	/** Everything ever queued; a rewind moves `keyIndex` back over it. */
	queued = ''
	keyIndex = 0
	display = ''

	claims(address: number, size: number): boolean {
		return address >= this.base && address + size <= this.base + 16 && address % 4 === 0 && size === 4
	}

	read(address: number): bigint {
		switch (address) {
			case this.base: return this.keyIndex < this.queued.length ? 1n : 0n
			case this.base + 4: {
				if (this.keyIndex >= this.queued.length) return 0n
				return BigInt(this.queued.charCodeAt(this.keyIndex++) & 0xFF)
			}
			case this.base + 8: return 1n
		}
		return 0n
	}

	write(address: number, _size: number, value: bigint) {
		if (address === this.base + 12) this.display += String.fromCharCode(Number(value & 0xFFn))
	}

	/** What the Keyboard and Display tool reads and writes. */
	device(): KeyboardDisplayDevice {
		return {
			state: () => ({ queuedInput: this.queued.slice(this.keyIndex), displayOutput: this.display }),
			queue: (input) => { this.queued += input },
		}
	}
}
