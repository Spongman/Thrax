/**
 * Ctrl+click on a name goes to its definition: a label (`name:`), a symbol
 * (`.equ name`, `.set name`, `name =`) or a macro (`.macro name`). Workspace
 * text is searched, so it works while the program does not assemble.
 */

import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition, symbolAt, type Definition, type GotoDefinitionSources } from '../../../services/gotoDefinition'
import type { SourceFile } from '../../contracts'
import { stripComments } from '../a64/assembler/source'
import { A64_LANGUAGE_ID } from './grammar'

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where `name` is defined in `files`, searched in order. */
export function findA64Definition(files: readonly SourceFile[], name: string): Definition | null {
	const escaped = escape(name)
	const patterns = [
		// Labels, any number of them, start a statement.
		new RegExp(`^(\\s*(?:[\\w.$]+\\s*:\\s*)*)(${escaped})\\s*:`),
		new RegExp(`^(\\s*\\.(?:equ|set|macro)\\s+)(${escaped})(?![\\w.$])`, 'i'),
		new RegExp(`^(\\s*)(${escaped})\\s*=`),
	]
	for (const file of files) {
		const lines = stripComments(file.code).split('\n')
		for (let line = 0; line < lines.length; line++) {
			for (const pattern of patterns) {
				const match = pattern.exec(lines[line])
				if (!match) continue
				const column = match[1].length + 1
				return { file: file.name, line: line + 1, column, endColumn: column + name.length }
			}
		}
	}
	return null
}

export function registerA64Definitions(monaco: typeof Monaco, sources: GotoDefinitionSources): Monaco.IDisposable {
	return registerGotoDefinition(monaco, sources, A64_LANGUAGE_ID, {
		nameAt: symbolAt,
		find: (files, name) => findA64Definition(files.map((file) => ({ name: file.title, code: file.code })), name),
	})
}
