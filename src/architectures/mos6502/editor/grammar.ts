/**
 * ca65-style 6502 syntax as plain data: the Monarch tokenizer and language
 * configuration Monaco takes, kept free of Monaco itself so they can be
 * tested headless.
 */

import type * as Monaco from 'monaco-editor'
import { MNEMONICS } from '../isa'

export const MOS6502_LANGUAGE_ID = 'ca65'

export const MOS6502_DIRECTIVES: readonly string[] = Object.freeze([
	'org', 'byte', 'db', 'byt', 'word', 'dw', 'addr', 'res', 'ds', 'ascii', 'asciiz', 'align',
	'include', 'macro', 'endmacro', 'endm', 'equ', 'set', 'breakpoint',
])

/** What a symbol may be spelled with. */
export const MOS6502_NAME = /[A-Za-z_.@][\w.@]*/

const mnemonics = MNEMONICS.flatMap((name) => [name, name.toLowerCase()])

export const mos6502Configuration: Monaco.languages.LanguageConfiguration = {
	comments: { lineComment: ';' },
	brackets: [['(', ')']],
	autoClosingPairs: [
		{ open: '(', close: ')' },
		{ open: '"', close: '"', notIn: ['string', 'comment'] },
	],
	wordPattern: /[A-Za-z_.@][\w.@]*/,
}

// Monarch reads `@name` in a rule as an attribute, so a literal @ is \x40.
export const mos6502Monarch: Monaco.languages.IMonarchLanguage = {
	defaultToken: '',
	mnemonics,
	tokenizer: {
		root: [
			[/;.*$/, 'comment'],
			[new RegExp(`\\.(?:${MOS6502_DIRECTIVES.join('|')})(?![\\w.\\x40])`, 'i'), 'keyword.directive'],
			// A label is a name followed by a colon, but z: and a: before an operand force its size.
			[/(?:[aAzZ])(?=:)/, 'keyword'],
			[/[A-Za-z_.\x40][\w.\x40]*(?=\s*:(?!=))/, 'type'],
			[/[A-Za-z_.\x40][\w.\x40]*/, { cases: { '@mnemonics': 'keyword', '[aAxXyY]': 'variable', '@default': 'identifier' } }],
			[/\$[0-9A-Fa-f]+/, 'number.hex'],
			[/%[01]+/, 'number.binary'],
			[/0[xX][0-9A-Fa-f]+/, 'number.hex'],
			[/\d+/, 'number'],
			[/"/, 'string', '@string'],
			[/'(?:[^'\\]|\\.)'/, 'string'],
			[/[()]/, '@brackets'],
			[/<<|>>|:=|[-+*/&|^~<>#,:=]/, 'operator'],
			[/\s+/, 'white'],
		],
		string: [
			[/[^"\\]+/, 'string'],
			[/\\./, 'string.escape'],
			[/"/, 'string', '@pop'],
		],
	},
}
