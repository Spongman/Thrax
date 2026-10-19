/**
 * Ctrl+click on an ARM name goes to its definition: a GNU label (`name:`), an
 * armasm label (the name in column 1), or an equate (`.equ name`, `.set
 * name`, `name =`, `name EQU`).  Workspace text is searched, so it works while
 * the program does not assemble.
 */

import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition, type Definition, type GotoDefinitionSources } from '../../../services/gotoDefinition'
import type { SourceFile } from '../../contracts'
import { ARM_LANGUAGE_ID } from './grammar'

const NAME = /[A-Za-z_.$][\w.$]*/g

/** The name under `column` (1-based) on `text`, or null. */
export function armSymbolAt(text: string, column: number): string | null {
	for (const match of text.matchAll(NAME)) {
		const start = match.index + 1
		if (column >= start && column < start + match[0].length) return match[0]
	}
	return null
}

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The line without its comment, columns kept. */
function code(line: string): string {
	const match = /@|;|\/\//.exec(line)
	return match ? line.slice(0, match.index) : line
}

/** Where `name` is defined in `files`, searched in order. */
export function findArmDefinition(files: readonly SourceFile[], name: string): Definition | null {
	if (name === '.') return null
	const escaped = escape(name)
	const patterns = [
		new RegExp(`(^|[^\\w.$])(${escaped})\\s*:`),
		new RegExp(`(^)(${escaped})(?![\\w.$])`),
		new RegExp(`(\\.(?:equ|set|equiv)\\s+)(${escaped})\\s*,`, 'i'),
		new RegExp(`(^\\s*)(${escaped})\\s*=`),
	]
	for (const file of files) {
		const lines = file.code.split('\n')
		for (let line = 0; line < lines.length; line++) {
			const text = code(lines[line])
			for (const pattern of patterns) {
				const match = pattern.exec(text)
				if (!match) continue
				const column = match.index + match[1].length + 1
				return { file: file.name, line: line + 1, column, endColumn: column + name.length }
			}
		}
	}
	return null
}

export function registerArmDefinitions(monaco: typeof Monaco, sources: GotoDefinitionSources): Monaco.IDisposable {
	return registerGotoDefinition(monaco, sources, ARM_LANGUAGE_ID, {
		nameAt: armSymbolAt,
		find: (files, name) => findArmDefinition(files.map((file) => ({ name: file.title, code: file.code })), name),
	})
}
