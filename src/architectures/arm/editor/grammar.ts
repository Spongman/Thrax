/**
 * ARM assembly syntax for Monaco as plain data, free of Monaco itself so it can
 * be tested headless.  One language covers both dialects: the editor has one
 * language per architecture, so `@`, `//` and `;` all start comments here,
 * which is armasm's `;` and GNU's `@` (GNU's `;`, a statement separator, is
 * shown as a comment start too).  The mnemonics are those of a profile.
 */

import type * as Monaco from 'monaco-editor'
import { ARCH_V8, COND_NAMES, DP_NAMES, REGISTER_ALIASES } from '../a32/isa'
import { ARMASM_DIRECTIVES, GNU_DIRECTIVE_NAMES } from '../assembler/parser'
import { MNEMONICS, MNEMONICS_V8 } from '../assembler/instructions'

export const ARM_LANGUAGE_ID = 'arm'

export const ARM_REGISTERS: readonly string[] = Object.freeze([...REGISTER_ALIASES.keys()])

/** ARMv8's status registers, as MRS and MSR name them. */
const STATUS_REGISTERS = ['apsr', 'cpsr', 'spsr', 'apsr_nzcvq', 'apsr_g', 'apsr_nzcvqg', 'cpsr_f', 'cpsr_c', 'cpsr_fc', 'cpsr_fsxc']

const CONDITIONS = [...COND_NAMES.filter(Boolean), 'al', 'hs', 'lo'].join('|')
const SUFFIXES = 's|p|b|t|bt|ia|ib|da|db|fd|ed|fa|ea'
const V8_SUFFIXES = `${SUFFIXES}|h|sb|sh|d`

const mnemonicPattern = (mnemonics: readonly string[], suffixes: string) =>
	`(?:${[...mnemonics].sort((left, right) => right.length - left.length).join('|')})(?:${CONDITIONS})?(?:${suffixes})?(?:${CONDITIONS})?`

/** Any ARMv2a mnemonic with its condition and suffixes in either order; bases longest first. */
export const MNEMONIC_PATTERN = mnemonicPattern(MNEMONICS, SUFFIXES)

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
function monarch(pattern: string, registers: readonly string[]): Monaco.languages.IMonarchLanguage {
	return {
		defaultToken: '',
		ignoreCase: true,
		armasmDirectives: [...ARMASM_DIRECTIVES].map((name) => name.toLowerCase()),
		registers,
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
				[new RegExp(`${pattern}(?![\\w.$])`), 'keyword'],
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
}

export const armMonarch: Monaco.languages.IMonarchLanguage = monarch(MNEMONIC_PATTERN, ARM_REGISTERS)

/** Data-processing names, for completion. */
export const ARM_COMPLETIONS: readonly string[] = Object.freeze([...new Set([...MNEMONICS, ...DP_NAMES])].sort())

export interface ArmGrammar {
	monarch: Monaco.languages.IMonarchLanguage
	completions: readonly string[]
	registers: readonly string[]
}

const V8_REGISTERS: readonly string[] = Object.freeze([...ARM_REGISTERS, ...STATUS_REGISTERS])

const GRAMMARS: readonly ArmGrammar[] = [
	{ monarch: armMonarch, completions: ARM_COMPLETIONS, registers: ARM_REGISTERS },
	{
		monarch: monarch(mnemonicPattern(MNEMONICS_V8, V8_SUFFIXES), V8_REGISTERS),
		completions: Object.freeze([...new Set([...MNEMONICS_V8, ...DP_NAMES])].sort()),
		registers: V8_REGISTERS,
	},
]

/** The grammar of the ARCH_* profile `arch`. */
export const armGrammar = (arch: number): ArmGrammar => GRAMMARS[arch === ARCH_V8 ? 1 : 0]
