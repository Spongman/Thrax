import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { disassemble } from '../disassembler'
import { firstError } from '../../../../core/diagnostics'

/**
 * `PseudoOps.txt` is the table MARS expands extended instructions by: 388 forms
 * over 83 mnemonics, each an example statement plus the basic-instruction
 * templates it becomes.  It is the specification of the extended set, so this
 * file reimplements its substitution language
 * (`ExtendedInstruction.makeTemplateSubstitutions`,
 * `mars/mips/instructions/ExtendedInstruction.java:212-561`) and checks that
 * THRAX expands every form into exactly the words MARS's templates describe.
 *
 * The one knowingly-unmatched form is listed in `DIVERGENT` below.
 */

const TABLE = fileURLToPath(new URL('./fixtures/PseudoOps.txt', import.meta.url))

/** Where the assembler puts the first `.data` datum and the first instruction. */
const DATA_BASE = 0x10010000
const TEXT_BASE = 0x00400000

/**
 * The table's examples stand for token *types*, not values (`PseudoOps.txt:80-83`),
 * and MARS picks the first form whose types accept the operands
 * (`OperandFormat.java:143-155`).  `100` is written for a 16-bit unsigned slot
 * but also fits the signed one, so a form spelled with it is only reached by a
 * value above 0x7fff; the source under test uses one, and the other placeholders
 * unchanged, so that each form is the one MARS would select.
 */
function representative(example: string): string {
	return example.replace(/(?<![\w$-])100(?![\d])/g, '40000')
}

interface Form {
	mnemonic: string
	/** The example statement, with each placeholder at a value that selects this form. */
	source: string
	/** Templates of the default expansion, `COMPACT` and description removed. */
	templates: string[]
	/** The alternative expansion for a 16-bit memory configuration, if any. */
	compact: string[]
	line: number
}

function readForms(): Form[] {
	const forms: Form[] = []
	readFileSync(TABLE, 'utf8').split('\n').forEach((line, index) => {
		if (!line.trim() || line.startsWith('#')) return
		const fields = line.split('\t').map((field) => field.trim()).filter(Boolean)
		const body = fields.slice(1).filter((field) => !field.startsWith('#'))
		const compactAt = body.indexOf('COMPACT')
		forms.push({
			mnemonic: fields[0].split(/\s+/)[0].toLowerCase(),
			source: representative(fields[0]),
			templates: compactAt < 0 ? body : body.slice(0, compactAt),
			compact: compactAt < 0 ? [] : body.slice(compactAt + 1),
			line: index + 1,
		})
	})
	return forms
}

const FORMS = readForms()
export const FORMS_FOR_REPORT = FORMS

/**
 * The example's tokens, numbered MARS's way: the operator is token 0,
 * parentheses and `+` are tokens, commas are not (`PseudoOps.txt:36`).
 */
function tokenize(example: string): string[] {
	return example.replace(/([(),+])/g, ' $1 ').split(/\s+/).filter((token) => token && token !== ',')
}

/** Java `int` arithmetic, which every substitution below is written in. */
const int = (value: number) => value | 0
const low = (value: number) => int(value << 16 >> 16)
const lowUnsigned = (value: number) => value & 0xffff
/** Bit 15 set means the low half reads as negative, so the high half carries a 1. */
const high = (value: number) => int((value >> 16) + ((value >> 15) & 1))
const highPlain = (value: number) => int(value >> 16)

/** The register one past `name`, as MARS's `NRn` substitutes it (`:508-531`). */
function nextRegister(name: string): string {
	const fp = /^\$f(\d+)$/.exec(name)
	if (fp) return `$f${Number(fp[1]) + 1}`
	const NAMES = [
		'$zero', '$at', '$v0', '$v1', '$a0', '$a1', '$a2', '$a3',
		'$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7',
		'$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7',
		'$t8', '$t9', '$k0', '$k1', '$gp', '$sp', '$fp', '$ra',
	]
	const index = NAMES.indexOf(name)
	return `$${index + 1}`
}

/** Replaces every occurrence of a literal marker, MARS's `substitute` (`:568`). */
function put(text: string, marker: string, value: string | number): string {
	return text.split(marker).join(String(value))
}

/**
 * One template line with its markers resolved.  `labelAddress` is the address
 * of the `label` operand; `addend` the constant of a `label+100000` operand.
 */
function substitute(template: string, tokens: string[], labelAddress: number): string {
	let text = template
	const valueOf = (token: string) => (token === 'label' ? labelAddress : Number(token))
	const addend = tokens.includes('+') ? Number(tokens[tokens.indexOf('+') + 1]) : 0

	for (let op = 1; op < tokens.length; op += 1) {
		const token = tokens[op]
		const value = valueOf(token)
		// Longest marker first, so `VHL2P1` is not eaten by `VHL2`.
		for (const m of [1, 2, 3, 4]) {
			text = put(text, `VHL${op}P${m}`, highPlain(value + m))
			text = put(text, `VH${op}P${m}`, high(value + m))
			text = put(text, `VL${op}P${m}U`, lowUnsigned(value + m))
			text = put(text, `VL${op}P${m}`, low(value + m))
			text = put(text, `LH${op}P${m}`, high(value + m))
			text = put(text, `LL${op}P${m}`, low(value + m))
		}
		text = put(text, `VHL${op}`, highPlain(value))
		text = put(text, `VH${op}`, high(value))
		text = put(text, `VL${op}U`, lowUnsigned(value))
		text = put(text, `VL${op}`, low(value))
		text = put(text, `LH${op}`, high(value))
		text = put(text, `LL${op}U`, lowUnsigned(value))
		text = put(text, `LL${op}`, low(value))
		text = put(text, `NR${op}`, nextRegister(token))
		text = put(text, `RG${op}`, token)
		text = put(text, `OP${op}`, token)
	}

	// Markers that always read token 2 (the label) and token 4 (the addend).
	text = put(text, 'LHL', highPlain(labelAddress))
	for (const m of [1, 2, 3, 4]) {
		text = put(text, `LHPAP${m}`, high(labelAddress + addend + m))
		text = put(text, `LLPP${m}`, low(labelAddress + addend + m))
	}
	text = put(text, 'LHPA', high(labelAddress + addend))
	text = put(text, 'LHPN', highPlain(labelAddress + addend))
	text = put(text, 'LLPU', lowUnsigned(labelAddress + addend))
	text = put(text, 'LLP', low(labelAddress + addend))
	text = put(text, 'S32', 32 - Number(tokens[tokens.length - 1]))
	// `LAB` names the branch target, and only the first occurrence (`:546-559`).
	text = text.replace('LAB', 'label')
	return text
}

/**
 * The basic instructions a form expands to, as source lines.  `DBNOP` emits a
 * `nop` only under delayed branching and otherwise nothing (`:227-230`), and
 * `BROFFnm` is a constant branch offset in words, `n` without delayed branching
 * and `m` with it (`:495-508`).  A word offset is written back out here as a
 * generated label, since THRAX's operand check wants a label in that slot.
 */
function expansionSource(form: Form, labelAddress: number, delayed: boolean): string {
	const lines: string[] = []
	for (const template of form.templates) {
		if (template.includes('DBNOP')) {
			if (delayed) lines.push('nop')
			continue
		}
		lines.push(substitute(template, tokenize(form.source), labelAddress))
	}

	const targets = new Map<number, string>()
	lines.forEach((line, index) => {
		const match = /BROFF(\d)(\d)/.exec(line)
		if (!match) return
		const name = `broff${index}`
		lines[index] = line.replace(match[0], name)
		targets.set(index + 1 + Number(delayed ? match[2] : match[1]), name)
	})

	return lines
		.map((line, index) => (targets.has(index) ? `${targets.get(index)}:\n${line}` : line))
		.concat(targets.has(lines.length) ? [`${targets.get(lines.length)}:`] : [])
		.join('\n')
}

/**
 * A form's statement in a program that defines `label`.  A branch target has to
 * be in `.text`; every other use of `label` is a data address.  Either way it
 * sits at a fixed address, so the expected and actual programs agree on it
 * whatever their lengths.
 */
function program(body: string, branchTarget: boolean): string {
	return branchTarget
		? `.text\nlabel:\n${body}\nnop\n`
		: `.data\nlabel: .word 0\n.text\n${body}\nnop\n`
}

function words(source: string, delayed: boolean): number[] {
	const result = assembleMips(source, undefined, { delayedBranching: delayed })
	const error = firstError(result.diagnostics)
	if (error) throw new Error(`${error.message} in:\n${source}`)
	// The trailing `nop` of the shell is not part of the expansion.
	return result.machineCode.slice(0, -1).map((word) => word >>> 0)
}

/**
 * Forms where THRAX knowingly does not reproduce the MARS template, each with
 * the reason.  Anything else must match word for word.
 */
const DIVERGENT = new Map<string, string>([
	[
		'swr $t1,40000',
		// The template drops the base register: `swr RG1, 0` instead of
		// `swr RG1, 0($1)`, so MARS stores through $zero and ignores the address
		// it just computed.  Every sibling form (sb/sh/sw/swl/...) has `0($1)`.
		'MARS template typo: `swr RG1, 0` loses the `($1)` base its siblings have',
	],
])

/** Compares a form's expansion against the template, and returns the reason it differs. */
function compare(form: Form, delayed = false): string | null {
	const branchTarget = form.templates.some((template) => template.includes('LAB'))
	const labelAddress = branchTarget ? TEXT_BASE : DATA_BASE
	let expected: number[]
	try {
		expected = words(program(expansionSource(form, labelAddress, delayed), branchTarget), delayed)
	} catch (error) {
		return `template does not assemble: ${(error as Error).message}`
	}
	let actual: number[]
	try {
		actual = words(program(form.source, branchTarget), delayed)
	} catch (error) {
		return `does not assemble: ${(error as Error).message}`
	}
	if (actual.length !== expected.length) return `expands to ${actual.length} words, MARS to ${expected.length}`
	const differs = actual.findIndex((word, index) => word !== expected[index])
	if (differs >= 0) return `word ${differs} is ${actual[differs].toString(16)}, MARS's is ${expected[differs].toString(16)}`
	// Matching MARS is the point, but a word that no form decodes would be a
	// hole in the isa table rather than in the expansion.
	const undecodable = actual.findIndex((word) => disassemble(word) === null)
	return undecodable < 0 ? null : `word ${undecodable} decodes as nothing`
}

describe('pseudo-op table', () => {
	it('covers the whole table', () => {
		expect(FORMS.length).toBe(388)
		expect(new Set(FORMS.map((form) => form.mnemonic)).size).toBe(83)
	})

	describe('expands exactly as MARS does', () => {
		it.each(FORMS.map((form) => [form.source, form] as const))('%s', (source, form) => {
			const reason = compare(form)
			if (DIVERGENT.has(source)) {
				expect(reason, `${source} no longer diverges; drop it from DIVERGENT`).not.toBeNull()
				return
			}
			expect(reason, `${source} (PseudoOps.txt:${form.line})`).toBeNull()
		})
	})

	describe('expands exactly as MARS does with delayed branching', () => {
		// Only the forms that branch over a delay slot of their own change.
		const delayed = FORMS.filter((form) => form.templates.some((template) => template.includes('DBNOP')))
		it.each(delayed.map((form) => [form.source, form] as const))('%s', (source, form) => {
			expect(compare(form, true), `${source} (PseudoOps.txt:${form.line})`).toBeNull()
		})
	})

	/**
	 * The `COMPACT` alternative applies only under a 16-bit memory
	 * configuration, which THRAX does not have yet (plan item X1).  Until it
	 * does, the default template is the only one that can be compared; this
	 * pins how many forms X1 will have to revisit.
	 */
	it('leaves the compact expansions for the memory-configuration work', () => {
		expect(FORMS.filter((form) => form.compact.length > 0)).toHaveLength(46)
	})
})
