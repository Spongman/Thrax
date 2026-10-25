import { stripAssemblyComment } from '../../../core/assembly/text'
/**
 * Ctrl+click on a Z80 name goes to its definition: a label (`name:` or a name
 * in the first column), an EQU, `=` or DEFL, or a macro. The workspace text is
 * searched, so it works while the program does not assemble.
 */

import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition, findPatternDefinition, escapeSymbol, symbolAt, type Definition, type GotoDefinitionSources } from '../../../services/gotoDefinition'
import type { WorkspaceFile } from '../../../services/workspace'
import { Z80_LANGUAGE_ID } from './grammar'

const NAME = /[A-Za-z_.?@][\w.?@]*/g

/** The name under `column` (1-based) on `text`, or null. */
export function z80SymbolAt(text: string, column: number): string | null {
	return symbolAt(text, column, NAME)
}


/** Where `name` is defined in `files`, searched in order. */
export function findZ80Definition(files: readonly WorkspaceFile[], name: string): Definition | null {
	const escaped = escapeSymbol(name)
	const patterns = [
		// A label with a colon, an assignment, or a name in the first column.
		new RegExp(`^(\\s*)(${escaped})\\s*(?::|\\s(?:equ|defl|macro)\\b|=)`, 'i'),
		new RegExp(`^()(${escaped})(?![\\w.?@])`),
		new RegExp(`^(\\s*\\.?macro\\s+)(${escaped})(?![\\w.?@])`, 'i'),
	]
	return findPatternDefinition(files, name, patterns, code => code.split('\n').map(line => stripAssemblyComment(line, [';'])), match => match[2] === name)
}

export function registerZ80Definitions(monaco: typeof Monaco, sources: GotoDefinitionSources): Monaco.IDisposable {
	return registerGotoDefinition(monaco, sources, Z80_LANGUAGE_ID, { nameAt: z80SymbolAt, find: findZ80Definition })
}
