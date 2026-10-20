/**
 * Ctrl+click on a name goes to its definition: a label (`name:`), a symbol
 * (`name =`, `name .equ`) or a macro (`.macro name`). Workspace text is
 * searched, so it works while the program does not assemble.
 */

import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition, type Definition, type GotoDefinitionSources } from '../../../services/gotoDefinition'
import type { SourceFile } from '../../contracts'
import { MOS6502_LANGUAGE_ID } from './grammar'

const NAME = /[A-Za-z_.@][\w.@]*/g

/** The name under `column` (1-based) on `text`, or null. */
export function mos6502SymbolAt(text: string, column: number): string | null {
	for (const match of text.matchAll(NAME)) {
		const start = match.index + 1
		if (column >= start && column < start + match[0].length) return match[0]
	}
	return null
}

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where `name` is defined in `files`, searched in order. */
export function findMos6502Definition(files: readonly SourceFile[], name: string): Definition | null {
	if (name.startsWith('.')) return null
	const escaped = escape(name)
	const patterns = [
		new RegExp(`^(\\s*)(${escaped})\\s*:(?!=)`),
		new RegExp(`^(\\s*)(${escaped})\\s*(?:=|:=|\\.?equ\\b|\\.set\\b)`, 'i'),
		new RegExp(`^(\\s*\\.macro\\s+)(${escaped})(?![\\w.@])`, 'i'),
		new RegExp(`^(\\s*\\.(?:equ|set)\\s+)(${escaped})(?![\\w.@])`, 'i'),
	]
	for (const file of files) {
		const lines = file.code.split('\n')
		for (let line = 0; line < lines.length; line++) {
			const comment = lines[line].indexOf(';')
			const text = comment < 0 ? lines[line] : lines[line].slice(0, comment)
			for (const pattern of patterns) {
				const match = pattern.exec(text)
				if (!match) continue
				const column = match[1].length + 1
				return { file: file.name, line: line + 1, column, endColumn: column + name.length }
			}
		}
	}
	return null
}

export function registerMos6502Definitions(monaco: typeof Monaco, sources: GotoDefinitionSources, language = MOS6502_LANGUAGE_ID): Monaco.IDisposable {
	return registerGotoDefinition(monaco, sources, language, {
		nameAt: mos6502SymbolAt,
		find: (files, name) => findMos6502Definition(files.map((file) => ({ name: file.title, code: file.code })), name),
	})
}
