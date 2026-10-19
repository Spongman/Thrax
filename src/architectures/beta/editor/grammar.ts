/**
 * UASM syntax as plain data: the Monarch tokenizer and language configuration
 * Monaco takes, kept free of Monaco itself so they can be tested headless.
 */

import type * as Monaco from 'monaco-editor'
import { betaLibrary } from '../uasm'

export const UASM_LANGUAGE_ID = 'uasm'

/** What a UASM symbol may be spelled with (BSim's identifier rule). */
export const UASM_NAME = /[$.@A-Za-z_][$.@\w]*/

export const UASM_DIRECTIVES: readonly string[] = Object.freeze([
	'include', 'align', 'ascii', 'text', 'options', 'macro', 'breakpoint', 'protect', 'unprotect', 'segment', 'pcheckoff', 'tcheckoff', 'verify',
])

export const UASM_REGISTERS: readonly string[] = Object.freeze([
	...Array.from({ length: 32 }, (_unused, index) => `R${index}`), 'BP', 'LP', 'SP', 'XP',
])

/** Every macro the bundled library defines, which is every instruction and convenience op. */
export const UASM_LIBRARY_MACROS: readonly string[] = Object.freeze(
	[...new Set(Array.from(betaLibrary.code.matchAll(/^\s*\.macro\s+([$.@A-Za-z_][$.@\w]*)/gm), (match) => match[1]))].sort(),
)

export const uasmConfiguration: Monaco.languages.LanguageConfiguration = {
	comments: { lineComment: '//', blockComment: ['/*', '*/'] },
	brackets: [['(', ')'], ['{', '}']],
	autoClosingPairs: [
		{ open: '(', close: ')' },
		{ open: '{', close: '}' },
		{ open: '"', close: '"', notIn: ['string', 'comment'] },
	],
	wordPattern: /[$.@A-Za-z_][$.@\w]*/,
}

// Monarch reads `@name` in a rule as an attribute, so a literal @ before a letter is \x40.
export const uasmMonarch: Monaco.languages.IMonarchLanguage = {
	defaultToken: '',
	macros: [...UASM_LIBRARY_MACROS],
	tokenizer: {
		root: [
			[/\/\/.*$/, 'comment'],
			[/\/\*/, 'comment', '@comment'],
			[new RegExp(`\\.(?:${UASM_DIRECTIVES.join('|')})(?![$.@\\w])`), 'keyword.directive'],
			// A label is a name followed by a colon, anywhere on the line.
			[/[$.\x40A-Za-z_][$.@\w]*(?=\s*:)/, 'type'],
			[/[Rr](?:3[01]|[12]?\d)(?![$.@\w])/, 'variable'],
			[/(?:BP|LP|SP|XP|bp|lp|sp|xp)(?![$.@\w])/, 'variable'],
			// A name followed by ( is a macro call: the library's are instructions.
			[/[$.\x40A-Za-z_][$.@\w]*(?=\s*\()/, { cases: { '@macros': 'keyword', '@default': 'function' } }],
			[/[$\x40A-Za-z_][$.@\w]*/, 'identifier'],
			// The location counter.
			[/\.(?![$.@\w])/, 'keyword'],
			[/0[xX][0-9a-fA-F]+/, 'number.hex'],
			[/0[bB][01]+/, 'number.binary'],
			[/0[0-7]+/, 'number.octal'],
			[/\d+/, 'number'],
			[/"/, 'string', '@string'],
			[/'(?:[^'\\]|\\(?:[0-7]{1,3}|.))'/, 'string'],
			[/[{}()]/, '@brackets'],
			[/<<|>>|[-+*/%&|~,:=]/, 'operator'],
			[/\s+/, 'white'],
		],
		comment: [
			[/[^*]+/, 'comment'],
			[/\*\//, 'comment', '@pop'],
			[/\*/, 'comment'],
		],
		string: [
			[/[^"\\]+/, 'string'],
			[/\\(?:[0-7]{1,3}|.)/, 'string.escape'],
			[/"/, 'string', '@pop'],
		],
	},
}
