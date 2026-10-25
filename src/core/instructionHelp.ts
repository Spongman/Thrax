import type { TokenDescription } from '../architectures/contracts'

export type InstructionHelp = Pick<TokenDescription, 'contents' | 'reference'>

/** Compact native data tables expand once, outside editing and execution paths. */
export function instructionHelpGroups(groups: readonly (readonly [names: string, operands: string, description: string, details?: readonly string[]])[]) {
	const entries: Record<string, { syntax: string, description: string, details?: readonly string[] }> = {}
	for (const [names, operands, description, details] of groups) for (const name of names.split(/\s+/)) {
		if (entries[name.toLowerCase()]) throw new Error(`Duplicate instruction documentation: ${name}`)
		entries[name.toLowerCase()] = { syntax: `${name.toUpperCase()}${operands ? ` ${operands}` : ''}`, description, details }
	}
	return entries
}

/** The manual location of one instruction, if known. */
export type InstructionLink = (mnemonic: string) => string | undefined

/**
 * Links into one manual: a page number opens `#page=N` of a PDF, and text is
 * appended to `base` (a path or `#anchor`).  A function derives the suffix
 * when the manual names its pages after the mnemonics.
 */
export function instructionLinks(base: string, suffixes: Readonly<Record<string, string | number>> | ((mnemonic: string) => string | number | undefined)): InstructionLink {
	const lookup = typeof suffixes === 'function' ? suffixes : (mnemonic: string) => Object.prototype.hasOwnProperty.call(suffixes, mnemonic) ? suffixes[mnemonic] : undefined
	return (mnemonic) => {
		const suffix = lookup(mnemonic.toLowerCase())
		return suffix === undefined ? undefined : typeof suffix === 'number' ? `${base}#page=${suffix}` : base + suffix
	}
}

/** Prefer verified per-instruction destinations, retaining a complete manual for gaps. */
export function preferInstructionLinks(primary: InstructionLink, fallback: InstructionLink): InstructionLink {
	return mnemonic => primary(mnemonic) ?? fallback(mnemonic)
}

/** Architecture-owned instruction data, rendered identically in every hover. */
export interface InstructionDocumentation {
	summary: string
	title?: string
	kind?: string
	forms?: readonly string[]
	details?: readonly string[]
	reference?: string
	/** This instruction's own place in the manual; the mnemonic links to it. */
	link?: string
}

export type InstructionTable = Readonly<Record<string, readonly [operands: string, summary: string, variants?: readonly string[]]>>

/** One native table supplies editor names, reference text and variant availability. */
export function instructionCatalog(table: InstructionTable, reference?: string, link?: InstructionLink) {
	const all = Object.keys(table)
	return {
		names: (variant?: string): readonly string[] => variant === undefined ? all : all.filter(name => !table[name][2] || table[name][2]!.includes(variant)),
		help: (name: string): InstructionHelp | null => tableInstructionHelp(name, table, reference, link),
	}
}

/** Markdown for a mnemonic, linked when its manual location is a web URL. */
function mnemonicMarkdown(mnemonic: string, link: string | undefined): string {
	const name = mnemonic.toUpperCase()
	return link && /^https?:\/\//.test(link) ? `**[${name}](${link.replace(/[()" ]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)} "Open ${name} in the manual")**` : `**${name}**`
}

export function instructionForms(forms: readonly string[]): string {
	const shown = forms.slice(0, 6).map((form) => `\`${form}\``).join(' · ')
	return forms.length > 6 ? `${shown} and ${forms.length - 6} more` : shown
}

export function formatInstructionHelp(mnemonic: string, doc: InstructionDocumentation): InstructionHelp {
	const title = [doc.title, doc.kind && `(${doc.kind})`].filter(Boolean).join(' ')
	return { reference: doc.reference, contents: [
		`${mnemonicMarkdown(mnemonic, doc.link)}${title ? ` — ${title}` : ''}`,
		doc.summary,
		...(doc.forms?.length ? [`Syntax: ${instructionForms(doc.forms)}`] : []),
		...(doc.details ?? []),
	] }
}

export function tableInstructionHelp(mnemonic: string, table: InstructionTable, reference?: string, link?: InstructionLink): InstructionHelp | null {
	const name = mnemonic.toLowerCase()
	const entry = Object.prototype.hasOwnProperty.call(table, name) ? table[name] : undefined
	return entry ? formatInstructionHelp(mnemonic, {
		summary: entry[1], forms: [`${mnemonic.toLowerCase()}${entry[0] ? ` ${entry[0]}` : ''}`], reference, link: link?.(name),
	}) : null
}
