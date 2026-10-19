/**
 * Address <-> source line relation of one assembled UASM program, for
 * breakpoints, source stepping and goto-definition.
 *
 * A macro-emitted instruction maps to the line that invoked the outermost
 * macro, with the whole expansion chain kept beside it. Instruction mappings
 * are split into words; data mappings stay whole. Lookups by address are a
 * binary search over typed arrays and allocate nothing.
 */

import type { ExpansionFrame } from '../../core/assembly/macroEngine'
import type { ProgramImage, SourceLocation } from '../contracts'

const NO_FRAMES: readonly ExpansionFrame[] = Object.freeze([])
const NO_ADDRESSES: readonly number[] = Object.freeze([])

/** A mapping that may carry its macro expansion, as AssemblyImage's do. */
export type BetaSourceMapping = ProgramImage['sourceMappings'][number] & { expansion?: readonly ExpansionFrame[] }

/** The parts of a ProgramImage the index reads. */
export interface BetaProgramImage {
	symbols: ProgramImage['symbols']
	sourceMappings: readonly BetaSourceMapping[]
}

interface Row {
	address: number
	length: number
	code: boolean
	line: number
	mapping: number
}

interface FileLines {
	/** Instruction addresses of each line, ascending. */
	code: Map<number, number[]>
	/** Lines with an instruction, ascending. */
	codeLines: number[]
}

export class BetaSourceIndex {
	private readonly starts: Uint32Array
	private readonly lengths: Uint32Array
	/** Interned (file, line) of each row; equal ids are the same statement. */
	private readonly lineIds: Int32Array
	private readonly rowMapping: Int32Array
	private readonly code: Uint8Array
	private readonly lines: SourceLocation[] = []
	private readonly files = new Map<string, FileLines>()
	private readonly symbolsByAddress = new Map<number, string>()
	private readonly symbolsByName = new Map<string, number>()
	private readonly sortedSymbols: { name: string; address: number }[]
	private readonly macros = new Map<string, SourceLocation>()

	constructor(private readonly image: BetaProgramImage) {
		const lineIds = new Map<string, number>()
		const rows: Row[] = []
		image.sourceMappings.forEach((mapping, index) => {
			const { file, line } = mapping.source
			const key = `${file}\n${line}`
			let id = lineIds.get(key)
			if (id === undefined) {
				id = this.lines.length
				lineIds.set(key, id)
				this.lines.push({ file, line })
			}
			const code = mapping.kind === 'instruction'
			if (code) {
				for (let offset = 0; offset < mapping.byteLength; offset += 4) {
					rows.push({ address: mapping.address + offset, length: Math.min(4, mapping.byteLength - offset), code, line: id, mapping: index })
					this.addCode(file, line, mapping.address + offset)
				}
			} else {
				rows.push({ address: mapping.address, length: mapping.byteLength, code, line: id, mapping: index })
			}
			for (const frame of mapping.expansion ?? NO_FRAMES) if (!this.macros.has(frame.macro)) this.macros.set(frame.macro, frame.definition)
		})
		rows.sort((left, right) => left.address - right.address)
		this.starts = Uint32Array.from(rows, (row) => row.address)
		this.lengths = Uint32Array.from(rows, (row) => row.length)
		this.lineIds = Int32Array.from(rows, (row) => row.line)
		this.rowMapping = Int32Array.from(rows, (row) => row.mapping)
		this.code = Uint8Array.from(rows, (row) => row.code ? 1 : 0)
		for (const lines of this.files.values()) {
			lines.codeLines = [...lines.code.keys()].sort((left, right) => left - right)
			for (const addresses of lines.code.values()) addresses.sort((left, right) => left - right)
		}
		for (const { name, address } of image.symbols) {
			if (!this.symbolsByAddress.has(address)) this.symbolsByAddress.set(address, name)
			this.symbolsByName.set(name, address)
		}
		this.sortedSymbols = [...image.symbols].sort((left, right) => left.address - right.address)
	}

	private addCode(file: string, line: number, address: number) {
		let lines = this.files.get(file)
		if (!lines) this.files.set(file, lines = { code: new Map(), codeLines: [] })
		const addresses = lines.code.get(line)
		if (addresses) addresses.push(address)
		else lines.code.set(line, [address])
	}

	/** Row holding `address`, or -1. */
	private rowAt(address: number): number {
		const starts = this.starts
		let low = 0
		let high = starts.length - 1
		while (low <= high) {
			const middle = (low + high) >> 1
			if (starts[middle] <= address) low = middle + 1
			else high = middle - 1
		}
		return high >= 0 && address < starts[high] + this.lengths[high] ? high : -1
	}

	/**
	 * Interned id of the statement at `address`, or -1. Two addresses with the
	 * same id came from the same source line, which is what source stepping
	 * compares on every step.
	 */
	lineIdAt(address: number): number {
		const row = this.rowAt(address & 0x7FFFFFFF)
		return row < 0 ? -1 : this.lineIds[row]
	}

	/** The (file, line) of a lineIdAt id. */
	lineOfId(id: number): SourceLocation | null {
		return this.lines[id] ?? null
	}

	lineForAddress(address: number): SourceLocation | null {
		return this.lineOfId(this.lineIdAt(address))
	}

	isCode(address: number): boolean {
		const row = this.rowAt(address & 0x7FFFFFFF)
		return row >= 0 && this.code[row] === 1
	}

	/** Macro invocations that produced the word at `address`, outermost first. */
	expansionAt(address: number): readonly ExpansionFrame[] {
		const row = this.rowAt(address & 0x7FFFFFFF)
		return row < 0 ? NO_FRAMES : this.image.sourceMappings[this.rowMapping[row]].expansion ?? NO_FRAMES
	}

	/** Instruction addresses a line assembled to, ascending. */
	addressesForLine(file: string, line: number): readonly number[] {
		return this.files.get(file)?.code.get(line) ?? NO_ADDRESSES
	}

	/** First instruction of a line: where a breakpoint on it goes. */
	codeAddressForLine(file: string, line: number): number | undefined {
		return this.addressesForLine(file, line)[0]
	}

	/** A click on a blank or comment line aims at the next line with code. */
	codeLineAtOrAfter(file: string, line: number): number | undefined {
		return this.files.get(file)?.codeLines.find((candidate) => candidate >= line)
	}

	codeAddressAtOrAfter(file: string, line: number): number | undefined {
		const target = this.codeLineAtOrAfter(file, line)
		return target === undefined ? undefined : this.codeAddressForLine(file, target)
	}

	/** Lines with an instruction, ascending. */
	codeLines(file: string): readonly number[] {
		return this.files.get(file)?.codeLines ?? NO_ADDRESSES
	}

	/** Files that assembled to an instruction. */
	codeFiles(): IterableIterator<string> {
		return this.files.keys()
	}

	/** Label exactly at `address`; the first defined when several share it. */
	symbolAt(address: number): string | undefined {
		return this.symbolsByAddress.get(address & 0x7FFFFFFF)
	}

	addressOf(name: string): number | undefined {
		return this.symbolsByName.get(name)
	}

	/** Nearest label at or below `address`, with the offset past it. */
	symbolFor(address: number): { name: string; offset: number } | null {
		const target = address & 0x7FFFFFFF
		const symbols = this.sortedSymbols
		let low = 0
		let high = symbols.length - 1
		while (low <= high) {
			const middle = (low + high) >> 1
			if (symbols[middle].address <= target) low = middle + 1
			else high = middle - 1
		}
		return high < 0 ? null : { name: symbols[high].name, offset: target - symbols[high].address }
	}

	/** Where a macro the program invoked is defined, library macros included. */
	macroDefinition(name: string): SourceLocation | null {
		return this.macros.get(name) ?? null
	}
}

export const EMPTY_BETA_SOURCE_INDEX = new BetaSourceIndex({ symbols: [], sourceMappings: [] })
