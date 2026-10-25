import { maskAssemblyComments } from '../../../../core/assembly/text'
/**
 * Source text as the parser reads it: comments blanked, then one logical line
 * at a time from a stack of files and macro expansions.
 */

import type { ExpansionFrame } from '../../../../core/assembly/macroEngine'

/** One line to parse, and where it came from. */
export interface LogicalLine {
	text: string
	file: string
	line: number
	/** Macro invocations that produced it, outermost first; the line is the outermost invocation's. */
	expansion: readonly ExpansionFrame[]
}

/**
 * `code` with `//` and `/* *\/` comments replaced by spaces, so columns and
 * line breaks stay where they were.  Quoted text is left alone.
 */
export function stripComments(code: string): string {
	return maskAssemblyComments(code, { line: ['//'], block: ['/*', '*/'], singleQuotes: 'character' })
}

const NO_FRAMES: readonly ExpansionFrame[] = Object.freeze([])

/** A file's lines, comments blanked. */
export function linesOf(file: string, code: string): LogicalLine[] {
	return stripComments(code.replace(/\r\n?/g, '\n')).split('\n').map((text, index) => ({ text, file, line: index + 1, expansion: NO_FRAMES }))
}

/** Reads lines from the innermost of a stack of sources. */
export class LineReader {
	private readonly frames: { lines: readonly LogicalLine[], index: number, depth: number }[] = []

	/** Depth of the innermost source; included files and expansions each add one. */
	get depth(): number {
		return this.frames[this.frames.length - 1]?.depth ?? 0
	}

	/** Reads `lines` next, ahead of whatever was being read. */
	push(lines: readonly LogicalLine[]) {
		this.frames.push({ lines, index: 0, depth: this.depth + 1 })
	}

	next(): LogicalLine | null {
		for (;;) {
			const frame = this.frames[this.frames.length - 1]
			if (!frame) return null
			if (frame.index < frame.lines.length) return frame.lines[frame.index++]
			this.frames.pop()
		}
	}
}
