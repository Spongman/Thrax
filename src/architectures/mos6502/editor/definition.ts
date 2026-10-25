import { stripAssemblyComment } from '../../../core/assembly/text'
/**
 * Ctrl+click on a name goes to its definition: a label (`name:`), a symbol
 * (`name =`, `name .equ`) or a macro (`.macro name`). Workspace text is
 * searched, so it works while the program does not assemble.
 */

import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition, findPatternDefinition, escapeSymbol, symbolAt, type Definition, type GotoDefinitionSources } from '../../../services/gotoDefinition'
import type { SourceFile } from '../../contracts'
import { MOS6502_LANGUAGE_ID } from './grammar'

const NAME = /[A-Za-z_.@][\w.@]*/g

/** The name under `column` (1-based) on `text`, or null. */
export function mos6502SymbolAt(text: string, column: number): string | null {
	return symbolAt(text, column, NAME)
}


/** Where `name` is defined in `files`, searched in order. */
export function findMos6502Definition(files: readonly SourceFile[], name: string): Definition | null {
	if (name.startsWith('.')) return null
	const escaped = escapeSymbol(name)
	const patterns = [
		new RegExp(`^(\\s*)(${escaped})\\s*:(?!=)`),
		new RegExp(`^(\\s*)(${escaped})\\s*(?:=|:=|\\.?equ\\b|\\.set\\b)`, 'i'),
		new RegExp(`^(\\s*\\.macro\\s+)(${escaped})(?![\\w.@])`, 'i'),
		new RegExp(`^(\\s*\\.(?:equ|set)\\s+)(${escaped})(?![\\w.@])`, 'i'),
	]
	return findPatternDefinition(files, name, patterns, code => code.split('\n').map(line => stripAssemblyComment(line, [';'])))
}

export function registerMos6502Definitions(monaco: typeof Monaco, sources: GotoDefinitionSources, language = MOS6502_LANGUAGE_ID): Monaco.IDisposable {
	return registerGotoDefinition(monaco, sources, language, {
		nameAt: mos6502SymbolAt,
		find: (files, name) => findMos6502Definition(files.map((file) => ({ name: file.title, code: file.code })), name),
	})
}
