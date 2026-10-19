/**
 * Ctrl+click on a Z80 name goes to its definition: a label (`name:` or a name
 * in the first column), an EQU, `=` or DEFL, or a macro. The workspace text is
 * searched, so it works while the program does not assemble.
 */

import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition, type Definition, type GotoDefinitionSources } from '../../../services/gotoDefinition'
import type { WorkspaceFile } from '../../../services/workspace'
import { Z80_LANGUAGE_ID } from './grammar'

const NAME = /[A-Za-z_.?@][\w.?@]*/g

/** The name under `column` (1-based) on `text`, or null. */
export function z80SymbolAt(text: string, column: number): string | null {
	for (const match of text.matchAll(NAME)) {
		const start = match.index + 1
		if (column >= start && column < start + match[0].length) return match[0]
	}
	return null
}

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where `name` is defined in `files`, searched in order. */
export function findZ80Definition(files: readonly WorkspaceFile[], name: string): Definition | null {
	const escaped = escape(name)
	const patterns = [
		// A label with a colon, an assignment, or a name in the first column.
		new RegExp(`^(\\s*)(${escaped})\\s*(?::|\\s(?:equ|defl|macro)\\b|=)`, 'i'),
		new RegExp(`^()(${escaped})(?![\\w.?@])`),
		new RegExp(`^(\\s*\\.?macro\\s+)(${escaped})(?![\\w.?@])`, 'i'),
	]
	for (const file of files) {
		const lines = file.code.split('\n')
		for (let line = 0; line < lines.length; line++) {
			const comment = lines[line].indexOf(';')
			const text = comment < 0 ? lines[line] : lines[line].slice(0, comment)
			for (const pattern of patterns) {
				const match = pattern.exec(text)
				// Names are case-sensitive, whatever the keywords are.
				if (!match || match[2] !== name) continue
				const column = match[1].length + 1
				return { file: file.title, line: line + 1, column, endColumn: column + name.length }
			}
		}
	}
	return null
}

export function registerZ80Definitions(monaco: typeof Monaco, sources: GotoDefinitionSources): Monaco.IDisposable {
	return registerGotoDefinition(monaco, sources, Z80_LANGUAGE_ID, { nameAt: z80SymbolAt, find: findZ80Definition })
}
