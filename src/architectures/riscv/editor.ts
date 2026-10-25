import { inspectAssemblyToken, type TokenInspection } from '../../services/assemblyInspection'
import type * as Monaco from 'monaco-editor'
import type { DebugInspection, EditorHost, RegisterValue, Registers, TokenDescription } from '../contracts'
import { disposableGroup } from '../../core/disposableScope'
import { registerAssemblyLanguage, registerTokenHover } from '../../services/assemblyLanguage'
import { manifest } from './manifest'
import { riscvInstructionHelp } from './instructionHelp'
import { ABI, FABI, fregister, register } from './isa'
import { RISCV_INSTRUCTIONS } from './catalog'
import { riscvIsa } from './variants'
import { bitsToDouble, bitsToSingle } from '../../core/ieee754'
import { assemblyDefinitions, registerGotoDefinition } from '../../services/gotoDefinition'

export const riscvDefinitions = assemblyDefinitions({ comments: ['#'] })

const inspection: TokenInspection = {
	tokens: /[\w.$]+/g, comments: ['#'],
	register: token => {
		try { return `x${register(token)}` } catch { /* not an integer register */ }
		if (/^(?:fcsr|frm|fflags)$/i.test(token)) return token.toLowerCase()
		try { return `f${fregister(token)}` } catch { return undefined }
	},
	registerText: (token, _id, value) => `**${token}** = ${value} (0x${(Number(value) >>> 0).toString(16)})`,
	labelText: (token, address) => `**${token}** = 0x${address.toString(16)}`,
	help: riscvInstructionHelp,
}

const hex = (value: number) => `0x${(value >>> 0).toString(16).padStart(8, '0')}`
/** A float register reads as its single, and under D also as its double. */
function floatText(token: string, id: string, value: RegisterValue, registers: Registers): string {
	const low = Number(value), high = registers[`${id}.hi`]
	if (!/^f\d/.test(id)) return inspection.registerText(token, id, value)
	if (high === undefined) return `**${token}** = ${bitsToSingle(low)} (${hex(low)})`
	const boxed = Number(high) === -1 || Number(high) >>> 0 === 0xffffffff
	return `**${token}** = ${boxed ? `${bitsToSingle(low)} (single, NaN-boxed)` : `${bitsToDouble(low, Number(high))} (double)`} (${hex(Number(high))}${hex(low).slice(2)})`
}

export function describeRiscvToken(text: string, offset: number, state: DebugInspection): TokenDescription | null {
	return inspectAssemblyToken(text, offset, state, { ...inspection, registerText: (token, id, value) => floatText(token, id, value, state.registers) })
}

export function installEditor(monaco: typeof Monaco, host: EditorHost) {
	const { Keyword, Variable } = monaco.languages.CompletionItemKind
	return disposableGroup((scope) => {
		scope.add(registerAssemblyLanguage(monaco, {
			id: 'thrax-riscv', extensions: [...manifest.fileExtensions],
			configuration: { comments: { lineComment: '#' }, wordPattern: /[A-Za-z_.$][\w.$]*/ },
			tokens: {
				ignoreCase: true,
				tokenizer: {
					root: [
						[/#.*$/, 'comment'],
						[/"([^"\\]|\\.)*"/, 'string'],
						[/\b(?:x(?:[0-9]|[12][0-9]|3[01])|zero|ra|sp|gp|tp|t[0-6]|s(?:[0-9]|1[01])|a[0-7]|fp)\b/, 'variable'],
						[/\b(?:f(?:[0-9]|[12][0-9]|3[01])|ft(?:[0-9]|1[01])|fs(?:[0-9]|1[01])|fa[0-7]|fcsr|frm|fflags)\b/, 'variable'],
						[/\b(?:rne|rtz|rdn|rup|rmm|dyn)\b/, 'variable'],
						[/\.[a-z][\w.]*/, 'keyword'],
						[/\b(?:0x[\da-f]+|\d+)\b/, 'number'],
						[/[\w.$]+:/, 'type.identifier'],
						[/[a-z][\w.]*/, 'keyword']
					]
				}
			},
			completions: () => {
				const isa = riscvIsa(host.settings?.() ?? { isa: 'rv32imc' }),
					registers = isa.flen ? [...ABI, ...FABI, 'fcsr', 'frm', 'fflags'] : ABI
				return [...registers, ...RISCV_INSTRUCTIONS.names(isa.id), '.text', '.data', '.word', '.byte', '.asciz', '.include', '.equ', '.align', ...(isa.flen ? ['.float', '.double'] : [])]
					.map((label) => ({ label, insertText: label, kind: registers.includes(label) ? Variable : Keyword }))
			},
		}))
		scope.add(registerTokenHover(monaco, 'thrax-riscv', (line, offset) => describeRiscvToken(line, offset, host.inspection())))
		scope.add(registerGotoDefinition(monaco, host, 'thrax-riscv', riscvDefinitions))
	})
}
