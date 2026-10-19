/**
 * GNU as A64 syntax as plain data: the Monarch tokenizer and language
 * configuration Monaco takes, kept free of Monaco itself so they can be tested
 * headless.
 */

import type * as Monaco from 'monaco-editor'
import { A64_DIRECTIVES, A64_MNEMONICS } from '../a64/assembler'
import { CONDITIONS } from '../a64/isa'

export const A64_LANGUAGE_ID = 'aarch64'

export const A64_REGISTER_NAMES: readonly string[] = Object.freeze([
	...Array.from({ length: 31 }, (_unused, index) => `x${index}`),
	...Array.from({ length: 31 }, (_unused, index) => `w${index}`),
	'sp', 'wsp', 'xzr', 'wzr', 'lr', 'fp',
])

/** Shift, extend and condition names, which read as operators. */
export const A64_OPERAND_WORDS: readonly string[] = Object.freeze([
	'lsl', 'lsr', 'asr', 'ror', 'uxtb', 'uxth', 'uxtw', 'uxtx', 'sxtb', 'sxth', 'sxtw', 'sxtx', ...CONDITIONS, 'hs', 'lo',
])

export const a64Configuration: Monaco.languages.LanguageConfiguration = {
	comments: { lineComment: '//', blockComment: ['/*', '*/'] },
	brackets: [['[', ']'], ['(', ')']],
	autoClosingPairs: [
		{ open: '[', close: ']' },
		{ open: '(', close: ')' },
		{ open: '"', close: '"', notIn: ['string', 'comment'] },
	],
	wordPattern: /[A-Za-z_.$][\w.$]*/,
}

export const a64Monarch: Monaco.languages.IMonarchLanguage = {
	defaultToken: '',
	ignoreCase: true,
	mnemonics: [...A64_MNEMONICS],
	registers: [...A64_REGISTER_NAMES],
	operands: [...A64_OPERAND_WORDS],
	directives: [...A64_DIRECTIVES],
	tokenizer: {
		root: [
			[/\/\/.*$/, 'comment'],
			[/\/\*/, 'comment', '@comment'],
			// A label is a name, or a number, followed by a colon.
			[/[A-Za-z_.$][\w.$]*(?=\s*:(?!lo12))/, 'type'],
			[/\d+(?=\s*:)/, 'type'],
			[/:lo12:/, 'keyword'],
			[/\.[A-Za-z_][\w.$]*/, { cases: { '@directives': 'keyword.directive', '@default': 'identifier' } }],
			[/[A-Za-z_$][\w.$]*/, { cases: { '@mnemonics': 'keyword', '@registers': 'variable', '@operands': 'operator', '@default': 'identifier' } }],
			[/\d+[fb]\b/, 'type'],
			[/0[xX][0-9a-fA-F]+/, 'number.hex'],
			[/0[bB][01]+/, 'number.binary'],
			[/\d+/, 'number'],
			[/"/, 'string', '@string'],
			[/'(?:[^'\\]|\\.)'?/, 'string'],
			[/[[\]()]/, '@brackets'],
			[/[#=!,:+\-*/%&|^~<>]/, 'operator'],
			[/\s+/, 'white'],
		],
		comment: [
			[/[^*]+/, 'comment'],
			[/\*\//, 'comment', '@pop'],
			[/\*/, 'comment'],
		],
		string: [
			[/[^"\\]+/, 'string'],
			[/\\./, 'string.escape'],
			[/"/, 'string', '@pop'],
		],
	},
}
