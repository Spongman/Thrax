/**
 * ARM assembly syntax for Monaco as plain data, free of Monaco itself so it can
 * be tested headless.  One language covers both dialects: the editor has one
 * language per architecture, so `@`, `//` and `;` all start comments here,
 * which is armasm's `;` and GNU's `@` (GNU's `;`, a statement separator, is
 * shown as a comment start too).
 */

import type * as Monaco from 'monaco-editor'
import { COND_NAMES, DP_NAMES, REGISTER_ALIASES } from '../a32/isa'
import { ARMASM_DIRECTIVES, GNU_DIRECTIVE_NAMES } from '../assembler/parser'
import { MNEMONICS } from '../assembler/instructions'

export const ARM_LANGUAGE_ID = 'arm'

export const ARM_REGISTERS: readonly string[] = Object.freeze([...REGISTER_ALIASES.keys()])

const CONDITIONS = [...COND_NAMES.filter(Boolean), 'al', 'hs', 'lo'].join('|')
const SUFFIXES = 's|p|b|t|bt|ia|ib|da|db|fd|ed|fa|ea'

/** Any mnemonic with its condition and suffixes in either order; bases longest first. */
export const MNEMONIC_PATTERN = `(?:${[...MNEMONICS].sort((left, right) => right.length - left.length).join('|')})(?:${CONDITIONS})?(?:${SUFFIXES})?(?:${CONDITIONS})?`

export const armConfiguration: Monaco.languages.LanguageConfiguration = {
	comments: { lineComment: '@', blockComment: ['/*', '*/'] },
	brackets: [['[', ']'], ['{', '}'], ['(', ')']],
	autoClosingPairs: [
		{ open: '[', close: ']' },
		{ open: '{', close: '}' },
		{ open: '(', close: ')' },
		{ open: '"', close: '"', notIn: ['string', 'comment'] },
	],
	wordPattern: /[A-Za-z_.$][\w.$]*/,
}

// Monarch reads `@name` in a rule as an attribute, so a literal @ is \x40.
export const armMonarch: Monaco.languages.IMonarchLanguage = {
	defaultToken: '',
	ignoreCase: true,
	armasmDirectives: [...ARMASM_DIRECTIVES].map((name) => name.toLowerCase()),
	registers: ARM_REGISTERS,
	tokenizer: {
		root: [
			[/\/\/.*$/, 'comment'],
			[/\x40.*$/, 'comment'],
			[/;.*$/, 'comment'],
			[/\/\*/, 'comment', '@comment'],
			// GNU labels end in a colon; armasm's start in column 1.
			[/[A-Za-z_.$][\w.$]*(?=\s*:)/, 'type'],
			[/^[A-Za-z_][\w]*/, 'type'],
			[new RegExp(`\\.(?:${GNU_DIRECTIVE_NAMES.join('|')})(?![\\w.$])`), 'keyword.directive'],
			[new RegExp(`${MNEMONIC_PATTERN}(?![\\w.$])`), 'keyword'],
			[/[A-Za-z_][\w]*/, { cases: { '@registers': 'variable', '@armasmDirectives': 'keyword.directive', '@default': 'identifier' } }],
			[/[.$][\w.$]*/, 'identifier'],
			[/:[A-Za-z]+:/, 'operator'],
			[/#/, 'operator'],
			[/0[xX][0-9a-fA-F]+/, 'number.hex'],
			[/&[0-9a-fA-F]+/, 'number.hex'],
			[/0[bB][01]+/, 'number.binary'],
			[/\d+_\d+/, 'number'],
			[/\d+[bf](?!\w)/, 'type'],
			[/\d+/, 'number'],
			[/"/, 'string', '@string'],
			[/'(?:[^'\\]|\\.)'/, 'string'],
			[/[[\]{}()]/, '@brackets'],
			[/<<|>>|[-+*/%&|^~!,=:]/, 'operator'],
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

/** Data-processing names, for completion. */
export const ARM_COMPLETIONS: readonly string[] = Object.freeze([...new Set([...MNEMONICS, ...DP_NAMES])].sort())
