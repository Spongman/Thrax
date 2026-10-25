import { stripAssemblyComment } from '../../../../core/assembly/text'
/**
 * Ctrl+click on an ARM name goes to its definition: a GNU label (`name:`), an
 * armasm label (the name in column 1), or an equate (`.equ name`, `.set
 * name`, `name =`, `name EQU`).  Workspace text is searched, so it works while
 * the program does not assemble.
 */

import type * as Monaco from 'monaco-editor'
import { registerGotoDefinition, findPatternDefinition, escapeSymbol, symbolAt, type Definition, type GotoDefinitionSources } from '../../../../services/gotoDefinition'
import type { SourceFile } from '../../../contracts'
import { ARM_LANGUAGE_ID } from './grammar'

const NAME = /[A-Za-z_.$][\w.$]*/g

/** The name under `column` (1-based) on `text`, or null. */
export function armSymbolAt(text: string, column: number): string | null {
	return symbolAt(text, column, NAME)
}


/** The line without its comment, columns kept. */
function code(line: string): string {
	return stripAssemblyComment(line, ['@', ';', '//'])
}

/** Where `name` is defined in `files`, searched in order. */
export function findArmDefinition(files: readonly SourceFile[], name: string): Definition | null {
	if (name === '.') return null
	const escaped = escapeSymbol(name)
	const patterns = [
		new RegExp(`(^|[^\\w.$])(${escaped})\\s*:`),
		new RegExp(`(^)(${escaped})(?![\\w.$])`),
		new RegExp(`(\\.(?:equ|set|equiv)\\s+)(${escaped})\\s*,`, 'i'),
		new RegExp(`(^\\s*)(${escaped})\\s*=`),
	]
	return findPatternDefinition(files, name, patterns, text => text.split('\n').map(code))
}

export function registerArmDefinitions(monaco: typeof Monaco, sources: GotoDefinitionSources, language = ARM_LANGUAGE_ID): Monaco.IDisposable {
	return registerGotoDefinition(monaco, sources, language, {
		nameAt: armSymbolAt,
		find: (files, name) => findArmDefinition(files.map((file) => ({ name: file.title, code: file.code })), name),
	})
}
