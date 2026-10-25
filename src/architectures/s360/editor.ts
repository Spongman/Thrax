import type * as Monaco from 'monaco-editor'
import { DIRECTIVES } from './assembler'

/**
 * Fixed fields: a name in column 1, the operation, operands up to the first
 * blank outside quotes, then remarks. A new line always restarts in `root`.
 */
export const tokens: Monaco.languages.IMonarchLanguage = {
	ignoreCase: true,
	directives: [...DIRECTIVES],
	tokenizer: {
		root: [
			[/^\*.*$/, 'comment'],
			[/^\.\*.*$/, 'comment'],
			[/^[A-Za-z@#$_][\w@#$]*/, 'type.identifier'],
			[/\s+/, { token: 'white', next: '@operation' }],
		],
		operation: [
			[/^/, { token: '', next: '@popall' }],
			[/[A-Za-z@#$_][\w@#$]*/, { cases: { '@directives': { token: 'keyword.directive', next: '@separator' }, '@default': { token: 'keyword', next: '@separator' } } }],
			[/\s+/, 'white'],
		],
		separator: [
			[/^/, { token: '', next: '@popall' }],
			[/\s+/, { token: 'white', next: '@operands' }],
		],
		operands: [
			[/^/, { token: '', next: '@popall' }],
			[/\s+.*$/, 'comment'],
			[/L'(?=[A-Za-z@#$_])/, 'operator'],
			[/(?:\d*[A-Za-z](?:L\d+)?)?'(?:[^']|'')*'/, 'string'],
			[/\d+/, 'number'],
			[/[A-Za-z@#$_][\w@#$]*/, 'identifier'],
			[/[=*+\-/]/, 'operator'],
			[/[(),]/, 'delimiter'],
		],
	},
}

/** A name defines a symbol in column 1; GNU-style `.equ name, value` is accepted too. */
export const editor = {
	tokens,
	directives: DIRECTIVES,
	definitions: (name: string) => [new RegExp(`^()(${name})(?![\\w@#$])`, 'i'), new RegExp(`^(\\s*\\.(?:equ|set)\\s+)(${name})(?![\\w@#$])`, 'i')],
}
