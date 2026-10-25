import { parseIntegerInput, readCString } from '../console'

export interface TeachingConsoleABI {
	integer: number
	character: number
	string: number
	exit: readonly number[]
}

export interface TeachingConsoleHost {
	argument(string: boolean): number
	write(text: string): void
	read(address: number): number
	stringLimit(): number
	halt(): void
}

/** Educational service behavior, selected by a native trap/ABI adapter. */
export class TeachingConsole {
	constructor(private readonly abi: TeachingConsoleABI, private readonly host: TeachingConsoleHost) {}

	dispatch(service: number): boolean {
		if (service === this.abi.integer) this.host.write(String(this.host.argument(false)))
		else if (service === this.abi.character) this.host.write(String.fromCharCode(this.host.argument(false) & 255))
		else if (service === this.abi.string) this.host.write(readCString(this.host.argument(true) >>> 0, this.host.stringLimit(), address => this.host.read(address)))
		else if (this.abi.exit.includes(service)) this.host.halt()
		else return false
		return true
	}
}

/** Accepted input is one native instruction capture; invalid input records nothing. */
export function recordIntegerInput(text: string, bits: number, instruction: {
	begin(): void
	accept(value: number): void
	close(): void
}): boolean {
	const value = parseIntegerInput(text, bits)
	if (value === null) return false
	instruction.begin()
	instruction.accept(value)
	instruction.close()
	return true
}
