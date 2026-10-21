/** Buffered character transport; arrival timing, IRQs and service ABIs stay native. */
export class BufferedConsole {
	output = ''
	/** Retain accepted input so history can restore the cursor without asking again. */
	input = ''
	inputIndex = 0
	waiting = false
	feed(text: string) { this.input += text }
	get available(): number { return this.input.length - this.inputIndex }
	readByte(normalizeNewline: boolean): number | undefined {
		if (!this.available) return undefined
		const code = this.input.charCodeAt(this.inputIndex++) & 255
		return normalizeNewline && code === 13 ? 10 : code
	}
}

/** Strict decimal teaching input, with the guest's range selected explicitly. */
export function parseIntegerInput(text: string, bits: number): number | null {
	if (!/^[+-]?\d+$/.test(text.trim())) return null
	const value = Number(text.trim())
	return Number.isSafeInteger(value) && value >= -(2 ** (bits - 1)) && value < 2 ** (bits - 1) ? value : null
}

/** Reads through a native memory accessor so mapping faults and observation are preserved. */
export function readCString(address: number, limit: number, read: (address: number) => number): string {
	let text = ''
	for (let offset = 0; offset < limit; offset++) {
		const byte = read(address + offset)
		if (byte === 0) return text
		text += String.fromCharCode(byte)
	}
	throw new Error('Unterminated console string')
}
