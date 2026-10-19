/**
 * Z80 syntax as plain data: the Monarch tokenizer and language configuration
 * Monaco takes, kept free of Monaco itself so they can be tested headless.
 */

import type * as Monaco from 'monaco-editor'
import { MNEMONICS } from '../asm/encoder'
import { DIRECTIVES } from '../asm/parser'

export const Z80_LANGUAGE_ID = 'z80'

export const Z80_MNEMONICS: readonly string[] = Object.freeze([...MNEMONICS].sort())
export const Z80_DIRECTIVES: readonly string[] = Object.freeze([...DIRECTIVES].sort())
export const Z80_REGISTER_WORDS: readonly string[] = Object.freeze([
	'A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'AF', 'BC', 'DE', 'HL', 'SP', 'IX', 'IY', 'IXH', 'IXL', 'IYH', 'IYL',
])
export const Z80_CONDITIONS: readonly string[] = Object.freeze(['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'])

const both = (words: readonly string[]) => words.flatMap((word) => [word, word.toLowerCase()])

export const z80Configuration: Monaco.languages.LanguageConfiguration = {
	comments: { lineComment: ';' },
	brackets: [['(', ')']],
	autoClosingPairs: [
		{ open: '(', close: ')' },
		{ open: '"', close: '"', notIn: ['string', 'comment'] },
	],
	wordPattern: /[A-Za-z_.?@][\w.?@]*'?/,
}

export const z80Monarch: Monaco.languages.IMonarchLanguage = {
	defaultToken: '',
	ignoreCase: true,
	mnemonics: both(Z80_MNEMONICS),
	directives: both(Z80_DIRECTIVES.flatMap((word) => [word, `.${word}`])),
	registers: both([...Z80_REGISTER_WORDS, 'AF\'']),
	conditions: both(Z80_CONDITIONS),
	tokenizer: {
		root: [
			[/;.*$/, 'comment'],
			// A label: a name and a colon, or a name in the first column.
			[/^[A-Za-z_.?\x40][\w.?\x40]*(?=\s*:)/, 'type'],
			[/[A-Za-z_.?\x40][\w.?\x40]*(?=\s*:)/, 'type'],
			[/[Aa][Ff]'/, 'variable'],
			[/^[A-Za-z_.?\x40][\w.?\x40]*/, { cases: { '@mnemonics': 'keyword', '@directives': 'keyword.directive', '@default': 'type' } }],
			[/[A-Za-z_.?\x40][\w.?\x40]*/, {
				cases: { '@mnemonics': 'keyword', '@directives': 'keyword.directive', '@registers': 'variable', '@conditions': 'variable.predefined', '@default': 'identifier' },
			}],
			[/(?:\$|#|0[xX])[0-9a-fA-F]+|[0-9][0-9a-fA-F]*[hH]\b/, 'number.hex'],
			[/(?:%|0[bB])[01]+|[01]+[bB]\b/, 'number.binary'],
			[/\d+/, 'number'],
			[/\$/, 'keyword'],
			[/"/, 'string', '@string'],
			[/'[^']*'/, 'string'],
			[/[()]/, '@brackets'],
			[/<<|>>|==|!=|<=|>=|&&|\|\||[-+*/%&|^~!<>,:=]/, 'operator'],
			[/\s+/, 'white'],
		],
		string: [
			[/[^"\\]+/, 'string'],
			[/\\./, 'string.escape'],
			[/"/, 'string', '@pop'],
		],
	},
}
