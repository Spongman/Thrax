import type { ArchitectureDefinition, ArchitectureServices, Disposable } from '../contracts'
import { assembleRiscv } from './assembler'
import { COMPRESSED_EXAMPLES, EXAMPLES } from './examples'
import { COMPRESSED_MNEMONICS } from './compressed'
import { ABI, MNEMONICS, register } from './isa'
import { manifest } from './manifest'
import { REGISTERS, riscvProfile } from './profile'
import { RiscvAssembly, createRiscvDisassembly, riscvDisassembly } from './program'
import { RiscvRuntime } from './runtime'
import { RISCV_SETTINGS, type RiscvSettings } from './settings'

const compressedVariant = {
	language: 'thrax-riscv',
	registers: REGISTERS,
	registerBanks: [{ id: 'cpu', label: 'Integer' }],
	examples: COMPRESSED_EXAMPLES
}
const compressedDisassembly = createRiscvDisassembly(true)

const definition: ArchitectureDefinition<ArchitectureServices<RiscvSettings>> = {
	...manifest,
	language: 'thrax-riscv',
	registers: REGISTERS,
	registerBanks: [{ id: 'cpu', label: 'Integer' }],
	examples: EXAMPLES,
	settings: RISCV_SETTINGS,
	variant: (settings) => (settings.isa === 'rv32imc' ? compressedVariant : definition),
	createServices() {
		let machine: RiscvRuntime | undefined,
			disposed = false,
			compressed = false
		const contributions: Disposable[] = []
		const check = () => {
			if (disposed) throw new Error('Architecture services have been disposed')
		}
		return {
			assemble(sources, settings) {
				check()
				compressed = settings.isa === 'rv32imc'
				return assembleRiscv(sources, compressed)
			},
			createMachine(program, _settings, options) {
				check()
				if (!(program instanceof RiscvAssembly)) throw new Error('Not a RISC-V program')
				const next = new RiscvRuntime(program, options)
				machine?.dispose()
				return (machine = next)
			},
			profile: () => riscvProfile,
			get disassembly() {
				return compressed ? compressedDisassembly : riscvDisassembly
			},
			describeToken(text, column, state) {
				for (const match of text.matchAll(/[\w.$]+/g)) {
					if (column < match.index! || column >= match.index! + match[0].length) continue
					try {
						const id = `x${register(match[0])}`,
							value = state.registers[id]
						return {
							start: match.index!,
							length: match[0].length,
							register: id,
							contents: [`**${match[0]}** = ${value} (0x${(Number(value) >>> 0).toString(16)})`]
						}
					} catch {
						const address = state.labels.get(match[0])
						return address === undefined
							? null
							: {
									start: match.index!,
									length: match[0].length,
									address,
									contents: [`**${match[0]}** = 0x${address.toString(16)}`]
								}
					}
				}
				return null
			},
			async installEditor(monaco, host) {
				check()
				const parts = [
					monaco.languages.register({ id: 'thrax-riscv', extensions: [...manifest.fileExtensions] }),
					monaco.languages.setLanguageConfiguration('thrax-riscv', {
						comments: { lineComment: '#' },
						wordPattern: /[A-Za-z_.$][\w.$]*/
					}),
					monaco.languages.setMonarchTokensProvider('thrax-riscv', {
						ignoreCase: true,
						tokenizer: {
							root: [
								[/#.*$/, 'comment'],
								[/"([^"\\]|\\.)*"/, 'string'],
								[/\b(?:x(?:[0-9]|[12][0-9]|3[01])|zero|ra|sp|gp|tp|t[0-6]|s(?:[0-9]|1[01])|a[0-7]|fp)\b/, 'variable'],
								[/\.[a-z][\w.]*/, 'keyword'],
								[/\b(?:0x[\da-f]+|\d+)\b/, 'number'],
								[/[\w.$]+:/, 'type.identifier'],
								[/[a-z][\w.]*/, 'keyword']
							]
						}
					}),
					monaco.languages.registerCompletionItemProvider('thrax-riscv', {
						provideCompletionItems: (model, position) => {
							const word = model.getWordUntilPosition(position)
							const range = {
								startLineNumber: position.lineNumber,
								endLineNumber: position.lineNumber,
								startColumn: word.startColumn,
								endColumn: word.endColumn
							}
							return {
								suggestions: [
									...ABI,
									...MNEMONICS,
									...COMPRESSED_MNEMONICS,
									'.text',
									'.data',
									'.word',
									'.byte',
									'.asciz',
									'.include',
									'.equ',
									'.align'
								].map((label) => ({
									label,
									kind: ABI.includes(label)
										? monaco.languages.CompletionItemKind.Variable
										: monaco.languages.CompletionItemKind.Keyword,
									insertText: label,
									range
								}))
							}
						}
					}),
					monaco.languages.registerHoverProvider('thrax-riscv', {
						provideHover(model, position) {
							const word = model.getWordAtPosition(position)
							if (!word) return null
							const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
							try {
								const index = register(word.word),
									value = host.inspection().registers[`x${index}`]
								return {
									range,
									contents: [
										{ value: `**x${index} (${ABI[index]})** = ${value} (0x${(Number(value) >>> 0).toString(16)})` }
									]
								}
							} catch {
								if (
									MNEMONICS.includes(word.word.toLowerCase()) ||
									COMPRESSED_MNEMONICS.includes(word.word.toLowerCase())
								)
									return {
										range,
										contents: [
											{
												value: `**${word.word.toUpperCase()}** — RV32IM/C integer assembly${word.word.startsWith('c.') ? ' (requires RV32IMC)' : ''}. [Instruction reference](https://docs.riscv.org/reference/isa/v20260120/unpriv/rv32.html)`
											}
										]
									}
								const address = host.inspection().labels.get(word.word)
								return address === undefined
									? null
									: { range, contents: [{ value: `**${word.word}** = 0x${address.toString(16)}` }] }
							}
						}
					})
				]
				const contribution = {
					dispose: () =>
						parts
							.splice(0)
							.reverse()
							.forEach((part) => part?.dispose())
				}
				contributions.push(contribution)
				return contribution
			},
			dispose() {
				if (disposed) return
				disposed = true
				machine?.dispose()
				contributions
					.splice(0)
					.reverse()
					.forEach((p) => p.dispose())
			}
		}
	}
}
export default definition
