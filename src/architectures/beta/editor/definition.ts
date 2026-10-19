/**
 * Ctrl+click on a UASM name goes to its definition: a label (`name:`), a
 * macro (`.macro name(`) or a symbol (`name = `). Workspace text is searched
 * first, so it works while the program does not assemble; the source index
 * then supplies macros defined in the bundled library.
 */

import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition, type Definition, type GotoDefinitionSources } from '../../../services/gotoDefinition'
import type { SourceFile } from '../../contracts'
import type { BetaSourceIndex } from '../sourceIndex'
import { betaLibrary } from '../uasm'
import { UASM_LANGUAGE_ID } from './grammar'

const NAME = /[$.@A-Za-z_][$.@\w]*/g

/** The name under `column` (1-based) on `text`, or null. */
export function uasmSymbolAt(text: string, column: number): string | null {
	for (const match of text.matchAll(NAME)) {
		const start = match.index + 1
		if (column >= start && column < start + match[0].length) return match[0]
	}
	return null
}

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Blanks comments, keeping columns; `inBlock` carries an open block comment across lines. */
function stripComments(line: string, state: { inBlock: boolean }): string {
	let out = ''
	let index = 0
	while (index < line.length) {
		if (state.inBlock) {
			const end = line.indexOf('*/', index)
			const stop = end < 0 ? line.length : end + 2
			out += ' '.repeat(stop - index)
			index = stop
			if (end >= 0) state.inBlock = false
		} else if (line.startsWith('//', index)) {
			break
		} else if (line.startsWith('/*', index)) {
			state.inBlock = true
		} else {
			out += line[index++]
		}
	}
	return out
}

/** Where `name` is defined in `files`, searched in order. */
export function findUasmDefinition(files: readonly SourceFile[], name: string, index?: BetaSourceIndex | null): Definition | null {
	if (name === '.') return null
	const escaped = escape(name)
	const patterns = [
		new RegExp(`(^|[^$.@\\w])(${escaped})\\s*:`),
		new RegExp(`(\\.macro\\s+)(${escaped})\\s*\\(`),
		new RegExp(`(^|[^$.@\\w])(${escaped})\\s*=`),
	]
	for (const file of files) {
		const state = { inBlock: false }
		const lines = file.code.split('\n')
		for (let line = 0; line < lines.length; line++) {
			const text = stripComments(lines[line], state)
			for (const pattern of patterns) {
				const match = pattern.exec(text)
				if (!match) continue
				// Group 1 is what precedes the name.
				const column = match.index + match[1].length + 1
				return { file: file.name, line: line + 1, column, endColumn: column + name.length }
			}
		}
	}
	const macro = index?.macroDefinition(name)
	if (macro) {
		const column = macro.column ?? 1
		return { file: macro.file, line: macro.line, column, endColumn: column + name.length }
	}
	return null
}

export interface UasmDefinitionSources extends GotoDefinitionSources {
	/** The last assembled program's index, for library macros. */
	sourceIndex?: () => BetaSourceIndex | null
	/** Read-only sources a definition may land in, such as the bundled library. */
	libraries?: readonly SourceFile[]
}

/** Go-to-definition through the shared provider, with UASM's names and the bundled library. */
export function registerUasmDefinitions(monaco: typeof Monaco, sources: UasmDefinitionSources): Monaco.IDisposable {
	const libraries = (sources.libraries ?? [betaLibrary]).map((library) => ({ title: library.name, code: library.code }))
	return registerGotoDefinition(monaco, sources, UASM_LANGUAGE_ID, {
		nameAt: uasmSymbolAt,
		find: (files, name) => findUasmDefinition(files.map((file) => ({ name: file.title, code: file.code })), name, sources.sourceIndex?.()),
		libraries: () => libraries,
	})
}
