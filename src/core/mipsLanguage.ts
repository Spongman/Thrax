import * as monaco from 'monaco-editor'
import { INSTRUCTION_MNEMONICS } from './isa'
import { instructionHelp, instructionSignature } from './isaDocs'

/**
 * Every mnemonic the assembler accepts, lower case and in alphabetical order,
 * which is the order the completion list offers them in.  The one table says
 * what they are, so an instruction added there is offered here (`isa.ts`).
 */
const MNEMONICS: readonly string[] =
	[...INSTRUCTION_MNEMONICS].map((mnemonic) => mnemonic.toLowerCase()).sort()

export function registerMipsLanguage(): void {
	monaco.languages.register({ id: 'mips' })

	monaco.languages.setLanguageConfiguration('mips', {
		comments: { lineComment: '#' },
		// A word runs through `.` and `$`, so `add.s` and `$t0` are each one
		// word: what completion replaces, and what a double click selects.  It
		// is what a name may be spelled with (`gotoDefinition.ts:23`).
		wordPattern: /[A-Za-z_.$][\w.$]*/,
	})

	monaco.languages.setMonarchTokensProvider('mips', {
		tokenizer: {
			root: [
				// Comments
				[/#.*$/, 'comment'],

				// Directives
				[/\.[a-zA-Z_]\w*/, 'keyword'],

				// Coprocessor instructions, before the plain mnemonics so the
				// format suffix is highlighted with them.
				[
					/\b(l\.[sd]|s\.[sd]|li\.[sd]|lwc1|swc1|ldc1|sdc1|mtc1|mfc1|mtc0|mfc0|eret|bc1[tf]|mov[tf]|(?:add|sub|mul|div|abs|neg|sqrt|mov)\.[sd]|c\.(?:eq|lt|le)\.[sd]|cvt\.[sdw]\.[sdw]|(?:round|trunc|ceil|floor)\.w\.[sd])\b/i,
					'keyword',
				],

				// Instructions
				[
					/\b(add|addu|addi|addiu|sub|subu|mul|mult|multu|div|divu|and|andi|or|ori|xor|xori|nor|sll|srl|sra|sllv|srlv|srav|slt|slti|sltu|sltiu|beq|bne|bgez|bgtz|blez|bltz|j|jal|jr|jalr|lw|lh|lhu|lb|lbu|sw|sh|sb|lui|la|mfhi|mflo|mthi|mtlo|move|li|nop|syscall)\b/i,
					'keyword',
				],

				// Macro parameters
				[/%[a-zA-Z_]\w*/, 'variable'],

				// Registers
				[/\$f\d{1,2}\b/i, 'variable'],
				[/\$(zero|at|v[0-1]|a[0-3]|t[0-9]|s[0-7]|k[0-1]|gp|sp|fp|ra|hi|lo|pc)\b/i, 'variable'],
				[/\$\d+/, 'variable'],

				// Labels
				[/^\s*[a-zA-Z_]\w*(?=:)/, 'type'],

				// Numbers
				[/0x[0-9a-fA-F]+/, 'number'],
				[/\d+/, 'number'],

				// Strings and character literals
				[/"([^"\\]|\\.)*"/, 'string'],
				[/'([^'\\]|\\.)'/, 'string'],

				// Operators and punctuation
				[/[,():+-]/, 'operator'],
				[/\s+/, 'white'],
			],
		},
	})

	// Completion items
	monaco.languages.registerCompletionItemProvider('mips', {
		provideCompletionItems: (model, position) => {
			// The word already typed is replaced rather than added to, so
			// completing `ad` gives `add` and not `adadd`.  A mnemonic keeps its
			// format suffix and a register its `$`, which is what the word
			// pattern above is for.
			const word = model.getWordUntilPosition(position)
			const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, position.column)

			const registers = [
				'$zero', '$at', '$v0', '$v1',
				'$a0', '$a1', '$a2', '$a3',
				'$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7',
				'$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7',
				'$t8', '$t9', '$k0', '$k1',
				'$gp', '$sp', '$fp', '$ra', '$pc', '$hi', '$lo',
				...Array.from({ length: 32 }, (_unused, index) => `$f${index}`),
			]

			return {
				suggestions: [
					...MNEMONICS.map((mnemonic) => ({
						label: mnemonic,
						kind: monaco.languages.CompletionItemKind.Keyword,
						insertText: mnemonic,
						range,
						detail: instructionSignature(mnemonic),
						documentation: { value: (instructionHelp(mnemonic) ?? []).join('\n\n') },
					})),
					...registers.map((reg) => ({
						label: reg,
						kind: monaco.languages.CompletionItemKind.Variable,
						insertText: reg,
						range,
						documentation: `Register: ${reg}`,
					})),
				],
			}
		},
	})
}
