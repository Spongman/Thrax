/**
 * The line-to-address relation of one assembled program.
 *
 * Addresses are only known once pseudo-instructions have expanded, so the
 * assembler builds this from its finished layout and hangs it on the program.
 * Everything downstream - the editor's gutter, its decorations, breakpoints,
 * and which words a paced run animates - reads it rather than rebuilding a map
 * of its own.
 */

import type { CodeRow, MemoryInspector } from '../architectures/contracts'

/** Where a machine word came from. */
export interface SourceLocation {
	file: string
	line: number
}

/** One word of a source line: an instruction, or four bytes of data. */
export interface SourceRow {
	address: number
	/** Index into the program's instructions and machine code; null for data. */
	instruction: number | null
	/** Directive that wrote a data row's bytes, which is how it reads back. */
	directive?: string
	/** Byte offset of a data row within that directive's data. */
	offset?: number
	/**
	 * Bytes this row covers: a data row's share of its directive, which the last
	 * row cuts short, or an instruction's length where it is not one word.
	 */
	length?: number
	/** Set on the last row of data too long to show in full. */
	truncated?: boolean
}

/** A row together with the line that assembled it. */
export interface SourceEntry extends SourceRow, SourceLocation {}

const NO_ROWS: SourceRow[] = []
const NO_LINES = new Map<number, SourceRow[]>()
const NO_ADDRESSES: ReadonlySet<number> = new Set<number>()

/** One file's lines, in the order the layout reached them. */
interface FileIndex {
	lines: Map<number, SourceRow[]>
	/** Lines holding at least one instruction, in ascending order. */
	codeLines: number[]
	/** Address of the first instruction on each of those lines. */
	codeAddresses: Set<number>
	/** The same lines as a set, so a second instruction on one is not counted twice. */
	seen: Set<number>
}

export class SourceIndex {
	private readonly byFile = new Map<string, FileIndex>()
	private readonly byAddress = new Map<number, SourceLocation>()

	/**
	 * `entryFile` is the file the debugger follows: the one whose lines the
	 * editor decorates and whose addresses stepping stops on.
	 */
	constructor(public readonly entryFile: string, entries: Iterable<SourceEntry> = []) {
		for (const { file, line, ...row } of entries) {
			const index = this.fileIndex(file)
			const rows = index.lines.get(line)
			if (rows) rows.push(row)
			else index.lines.set(line, [row])
			this.byAddress.set(row.address, { file, line })
			if (row.instruction !== null && !index.seen.has(line)) {
				index.seen.add(line)
				index.codeLines.push(line)
				index.codeAddresses.add(row.address)
			}
		}
		for (const index of this.byFile.values()) index.codeLines.sort((left, right) => left - right)
	}

	private fileIndex(file: string): FileIndex {
		const existing = this.byFile.get(file)
		if (existing) return existing
		const created: FileIndex = { lines: new Map(), codeLines: [], codeAddresses: new Set(), seen: new Set() }
		this.byFile.set(file, created)
		return created
	}

	/** Every word a line assembled to, first one first. */
	rowsForLine(file: string, line: number): SourceRow[] {
		return this.byFile.get(file)?.lines.get(line) ?? NO_ROWS
	}

	addressesForLine(file: string, line: number): number[] {
		return this.rowsForLine(file, line).map((row) => row.address)
	}

	/** Address of the first instruction on a line, which is where a breakpoint goes. */
	codeAddressForLine(file: string, line: number): number | undefined {
		return this.rowsForLine(file, line).find((row) => row.instruction !== null)?.address
	}

	lineForAddress(address: number): SourceLocation | null {
		return this.byAddress.get(address) ?? null
	}

	/** Every file that assembled to something, in the order the layout reached them. */
	files(): IterableIterator<string> {
		return this.byFile.keys()
	}

	/** Lines that assembled to something, in layout order: instructions, then data. */
	lines(file: string): IterableIterator<[number, SourceRow[]]> {
		return (this.byFile.get(file)?.lines ?? NO_LINES).entries()
	}

	/** Where every instruction of a file starts, which is all the editor can point at. */
	codeAddresses(file: string): ReadonlySet<number> {
		return this.byFile.get(file)?.codeAddresses ?? NO_ADDRESSES
	}

	/** Whether the file assembled to any instruction at all. */
	hasCode(file: string): boolean {
		return (this.byFile.get(file)?.codeLines.length ?? 0) > 0
	}

	/** Blank and comment lines carry no address, so a click on one aims forward. */
	codeLineAtOrAfter(file: string, line: number): number | undefined {
		return this.byFile.get(file)?.codeLines.find((candidate) => candidate >= line)
	}

	/** The address a click at `line` reaches, looking forward past blank lines. */
	codeAddressAtOrAfter(file: string, line: number): number | undefined {
		const target = this.codeLineAtOrAfter(file, line)
		return target === undefined ? undefined : this.codeAddressForLine(file, target)
	}
}

/** The index of a source that never assembled. */
export const EMPTY_SOURCE_INDEX = new SourceIndex('')

/**
 * A row as the gutter shows it.  The index says which bytes a line owns; they
 * are read live, so data the program has written to shows what it holds now,
 * and so does an instruction it overwrote.
 */
export function codeRowOf(row: SourceRow, memory: MemoryInspector): CodeRow {
	if (row.instruction === null) {
		const bytes = Array.from({ length: row.length ?? 0 }, (_, offset) => memory.byte(row.address + offset) ?? 0)
		return { address: row.address, instruction: false, bytes, directive: row.directive, offset: row.offset, truncated: row.truncated }
	}
	// Each word of an encoding is written most significant byte first, whatever the byte order.
	const { littleEndian } = memory
	// A short instruction can occupy less than one debugger memory word.
	// Reverse only its own bytes, so a two-byte instruction never reads the next one.
	const wordBytes = Math.min(memory.wordBytes, row.length ?? memory.wordBytes)
	const bytes = Array.from({ length: row.length ?? wordBytes }, (_, offset) => {
		const within = offset % wordBytes
		const groupBytes = Math.min(wordBytes, (row.length ?? wordBytes) - offset + within)
		return memory.byte(row.address + offset - within + (littleEndian ? groupBytes - 1 - within : within)) ?? 0
	})
	return { address: row.address, instruction: true, bytes }
}
