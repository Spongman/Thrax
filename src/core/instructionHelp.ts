import type { TokenDescription } from '../architectures/contracts'

export type InstructionHelp = Pick<TokenDescription, 'contents' | 'reference'>

/** Architecture-owned instruction data, rendered identically in every hover. */
export interface InstructionDocumentation {
	summary: string
	title?: string
	kind?: string
	forms?: readonly string[]
	details?: readonly string[]
	reference?: string
}

export type InstructionTable = Readonly<Record<string, readonly [operands: string, summary: string]>>

export function instructionForms(forms: readonly string[]): string {
	const shown = forms.slice(0, 6).map((form) => `\`${form}\``).join(' · ')
	return forms.length > 6 ? `${shown} and ${forms.length - 6} more` : shown
}

export function formatInstructionHelp(mnemonic: string, doc: InstructionDocumentation): InstructionHelp {
	const title = [doc.title, doc.kind && `(${doc.kind})`].filter(Boolean).join(' ')
	return { reference: doc.reference, contents: [
		`**${mnemonic.toUpperCase()}**${title ? ` — ${title}` : ''}`,
		doc.summary,
		...(doc.forms?.length ? [`Syntax: ${instructionForms(doc.forms)}`] : []),
		...(doc.details ?? []),
	] }
}

export function tableInstructionHelp(mnemonic: string, table: InstructionTable, reference?: string): InstructionHelp | null {
	const name = mnemonic.toLowerCase()
	const entry = Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined
	return entry ? formatInstructionHelp(mnemonic, {
		summary: entry[1], forms: [`${mnemonic.toLowerCase()}${entry[0] ? ` ${entry[0]}` : ''}`], reference,
	}) : null
}
