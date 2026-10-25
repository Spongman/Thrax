import { maskAssemblyComments } from '../../../core/assembly/text'
/**
 * Ctrl+click on a UASM name goes to its definition: a label (`name:`), a
 * macro (`.macro name(`) or a symbol (`name = `). Workspace text is searched
 * first, so it works while the program does not assemble; the source index
 * then supplies macros defined in the bundled library.
 */

import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition, findPatternDefinition, escapeSymbol, symbolAt, type Definition, type GotoDefinitionSources } from '../../../services/gotoDefinition'
import type { SourceFile } from '../../contracts'
import type { BetaSourceIndex } from '../sourceIndex'
import { betaLibrary } from '../uasm'
import { UASM_LANGUAGE_ID } from './grammar'

const NAME = /[$.@A-Za-z_][$.@\w]*/g

/** The name under `column` (1-based) on `text`, or null. */
export function uasmSymbolAt(text: string, column: number): string | null {
	return symbolAt(text, column, NAME)
}

/** Where `name` is defined in `files`, searched in order. */
export function findUasmDefinition(files: readonly SourceFile[], name: string, index?: BetaSourceIndex | null): Definition | null {
	if (name === '.') return null
	const escaped = escapeSymbol(name)
	const patterns = [
		new RegExp(`(^|[^$.@\\w])(${escaped})\\s*:`),
		new RegExp(`(\\.macro\\s+)(${escaped})\\s*\\(`),
		new RegExp(`(^|[^$.@\\w])(${escaped})\\s*=`),
	]
	const found = findPatternDefinition(files, name, patterns, code => maskAssemblyComments(code, { line: ['//'], block: ['/*', '*/'] }).split('\n'))
	if (found) return found
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
