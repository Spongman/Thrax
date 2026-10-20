import type {
	ArchitectureDefinition,
	ArchitectureServices,
	DebugInspection,
	Disposable,
	TokenDescription
} from '../contracts'
import { assembleM68k } from './assembler'
import { EXAMPLES, EXAMPLES_68010, EXAMPLES_68020 } from './examples'
import { MNEMONICS, REGISTER_NAMES } from './isa'
import { manifest } from './manifest'
import { m68kProfile, REGISTERS } from './profile'
import { M68kAssembly, m68kDisassembly } from './program'
import { M68kRuntime } from './runtime'
import { M68K_SETTINGS, type M68kSettings } from './settings'

const VARIANTS = {
	'68000': {
		language: 'thrax-m68k',
		registers: REGISTERS,
		registerBanks: [{ id: 'cpu', label: '68000 family' }],
		examples: EXAMPLES
	},
	'68010': {
		language: 'thrax-m68k',
		registers: REGISTERS,
		registerBanks: [{ id: 'cpu', label: '68000 family' }],
		examples: EXAMPLES_68010
	},
	'68020': {
		language: 'thrax-m68k',
		registers: REGISTERS,
		registerBanks: [{ id: 'cpu', label: '68000 family' }],
		examples: EXAMPLES_68020
	}
}

function describeToken(text: string, column: number, state: DebugInspection): TokenDescription | null {
	for (const match of text.matchAll(/[\w.$]+/g)) {
		if (column < match.index! || column >= match.index! + match[0].length) continue
		const name = match[0].toUpperCase(),
			register = name === 'SP' ? 'A7' : name
		if (register in state.registers) {
			const value = state.registers[register]
			return {
				start: match.index!,
				length: match[0].length,
				register,
				contents: [`**${name}** = ${value} ($${(Number(value) >>> 0).toString(16)})`]
			}
		}
		const address = state.labels.get(match[0])
		if (address !== undefined)
			return {
				start: match.index!,
				length: match[0].length,
				address,
				contents: [`**${match[0]}** = $${address.toString(16)}`]
			}
	}
	return null
}
const definition: ArchitectureDefinition<ArchitectureServices<M68kSettings>> = {
	...manifest,
	language: 'thrax-m68k',
	registers: REGISTERS,
	registerBanks: [{ id: 'cpu', label: '68000 family' }],
	examples: EXAMPLES,
	settings: M68K_SETTINGS,
	variant(settings) {
		return settings.cpuModel === '68020'
			? VARIANTS['68020']
			: settings.cpuModel === '68010'
				? VARIANTS['68010']
				: VARIANTS['68000']
	},
	createServices() {
		let disposed = false,
			machine: M68kRuntime | undefined,
			model: M68kSettings['cpuModel'] = '68000'
		const parts: Disposable[] = []
		const check = () => {
			if (disposed) throw new Error('Architecture services have been disposed')
		}
		return {
			assemble(sources, settings) {
				check()
				model = settings.cpuModel
				return assembleM68k(sources, model)
			},
			createMachine(program, _settings, options) {
				check()
				if (!(program instanceof M68kAssembly)) throw new Error('Not a 68000 program')
				const next = new M68kRuntime(program, options)
				machine?.dispose()
				machine = next
				return next
			},
			profile: () => m68kProfile,
			disassembly: {
				row: (row, next) => m68kDisassembly(model).row(row, next),
				at: (memory, address) => m68kDisassembly(model).at(memory, address)
			},
			describeToken,
			async installEditor(monaco, host) {
				check()
				const contributions = [
					monaco.languages.register({ id: 'thrax-m68k', extensions: [...manifest.fileExtensions] }),
					monaco.languages.setMonarchTokensProvider('thrax-m68k', {
						ignoreCase: true,
						tokenizer: {
							root: [
								[/;.*/, 'comment'],
								[/^\s*\*.*/, 'comment'],
								[/"([^"\\]|\\.)*"|'([^'\\]|\\.)'/, 'string'],
								[/\b(?:d[0-7]|a[0-7]|sp|sr|ccr|pc)\b/, 'variable'],
								[/\$[\da-f]+|\b(?:0x[\da-f]+|\d+)\b/, 'number'],
								[/[\w.$]+:/, 'type.identifier'],
								[/[\w.]+/, 'keyword']
							]
						}
					}),
					monaco.languages.registerCompletionItemProvider('thrax-m68k', {
						provideCompletionItems(model, position) {
							const word = model.getWordUntilPosition(position),
								range = {
									startLineNumber: position.lineNumber,
									endLineNumber: position.lineNumber,
									startColumn: word.startColumn,
									endColumn: word.endColumn
								}
							return {
								suggestions: [
									...MNEMONICS,
									...REGISTER_NAMES,
									'sp',
									'ccr',
									'.text',
									'.data',
									'dc.b',
									'dc.w',
									'dc.l',
									'.asciz'
								].map((label) => ({
									label,
									insertText: label,
									kind: monaco.languages.CompletionItemKind.Keyword,
									range
								}))
							}
						}
					}),
					monaco.languages.registerHoverProvider('thrax-m68k', {
						provideHover(model, position) {
							const token = describeToken(
								model.getLineContent(position.lineNumber),
								position.column - 1,
								host.inspection()
							)
							if (token)
								return {
									range: new monaco.Range(
										position.lineNumber,
										token.start + 1,
										position.lineNumber,
										token.start + token.length + 1
									),
									contents: token.contents.map((value) => ({ value }))
								}
							const word = model.getWordAtPosition(position)
							if (word && MNEMONICS.includes(word.word.toLowerCase().replace(/\.[bwl]$/, '')))
								return {
									contents: [
										{
											value: `**${word.word.toUpperCase()}** — Motorola integer teaching profile. [Reference](https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf)`
										}
									]
								}
							return null
						}
					})
				]
				const contribution = {
					dispose: () =>
						contributions
							.splice(0)
							.reverse()
							.forEach((part) => part?.dispose())
				}
				parts.push(contribution)
				return contribution
			},
			dispose() {
				if (disposed) return
				disposed = true
				machine?.dispose()
				parts
					.splice(0)
					.reverse()
					.forEach((part) => part.dispose())
			}
		}
	}
}
export default definition
