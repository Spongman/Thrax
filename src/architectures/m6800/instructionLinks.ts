import { htmlInstructionLink as m6809InstructionLinkHtml } from './m6809HtmlReferences'
import { htmlInstructionLink as hc11InstructionLinkHtml } from './hc11HtmlReferences'
import { htmlInstructionLink as m6800InstructionLinkHtml } from './m6800HtmlReferences'
import { preferInstructionLinks, instructionLinks } from '../../core/instructionHelp'
import { reference as m6800Reference } from './isa'
import { reference as m6809Reference } from './m6809'
import { reference as hc11Reference } from './hc11'

/**
 * Pages of a manual that describes one instruction per page in alphabetical
 * order from `first`: `-` skips a continuation page and `a/b` shares a page.
 * Accumulator forms (LDAA, ASLB) fall back to their base page (LDA, ASL).
 */
function alphabeticalPages(first: number, order: string, aliases: Readonly<Record<string, string>> = {}) {
	const pages = new Map(order.split(' ').flatMap((names, index) => names.split('/').map((name) => [name, first + index] as const)))
	return (mnemonic: string) => {
		const name = aliases[mnemonic] ?? mnemonic
		return pages.get(name) ?? (/[ab]$/.test(name) ? pages.get(name.slice(0, -1)) : undefined)
	}
}

// Appendix A, Definition of the Executable Instructions.
const m6800InstructionLinkFallback = instructionLinks(m6800Reference, alphabeticalPages(36, 'aba adc add and asl/lsl asr bcc/bhs bcs/blo beq bge bgt bhi bit ble bls blt bmi bne bpl bra bsr bvc bvs cba clc cli clr clv cmp com cpx daa - dec des dex eor inc ins inx jmp jsr lda lds ldx lsr neg nop ora psh pul rol ror rti rts sba sbc sec sei sev sta sts stx sub swi - tab tap tba tpa tst tsx txs wai'))

// Appendix A, Instruction Set Details.
const hc11InstructionLinkFallback = instructionLinks(hc11Reference, alphabeticalPages(492, 'aba abx aby adc add addd and asl asld asr bcc bclr bcs beq bge bgt bhi bhs bit ble blo bls blt bmi bne bpl bra brclr brn brset bset bsr bvc bvs cba clc cli clr clv cmp com cpd cpx cpy daa - dec des dex dey eor fdiv idiv inc ins inx iny jmp jsr lda ldd lds ldx ldy lsl lsld lsr lsrd mul neg nop ora psh pshx pshy pul pulx puly rol ror rti rts sba sbc sec sei sev sta std stop sts stx sty sub subd swi tab tap tba test tpa tst tsx tsy txs tys wai - xgdx xgdy', { cmpx: 'cpx', cmpy: 'cpy', cmpd: 'cpd', ldb: 'lda', stb: 'sta', orb: 'ora' }))

// The 6809 Programming Manual's Appendix A, one instruction per page; ADD, CMP, LD, ST and SUB split by width.
const M6809_PAGES = new Map('abx adc add8 add16 and - asl asr bcc bcs beq bge bgt bhi bhs bit ble blo bls blt bmi bne bpl bra brn bsr bvc bvs clr cmp8 cmp16 com cwai daa dec eor exg inc jmp jsr ld8 ld16 lea lsl lsr mul neg nop or - pshs pshu puls pulu rol ror rti rts sbc sex st8 st16 sub8 sub16 swi swi2 swi3 sync tfr tst'
	.split(' ').map((name, index) => [name, 51 + index] as const))
const M6809_SIZED = new Set(['add', 'cmp', 'ld', 'st', 'sub'])
const M6800_NAMES: Readonly<Record<string, string>> = { ldaa: 'lda', ldab: 'ldb', staa: 'sta', stab: 'stb', oraa: 'ora', orab: 'orb', cpx: 'cmpx' }
const m6809InstructionLinkFallback = instructionLinks(m6809Reference, (mnemonic) => {
	const name = (M6800_NAMES[mnemonic] ?? mnemonic).replace(/^l(?=b)/, '')
	if (M6809_PAGES.has(name)) return M6809_PAGES.get(name)
	const base = name.slice(0, -1), register = name.slice(-1)
	if (!/[abdxyus]/.test(register)) return undefined
	return M6809_PAGES.get(M6809_SIZED.has(base) ? `${base}${/[ab]/.test(register) ? 8 : 16}` : base)
})

export const m6800InstructionLink = preferInstructionLinks(name => m6800InstructionLinkHtml(name.toLowerCase().replace(/^lsl/, 'asl')), m6800InstructionLinkFallback)

const HC11_HTML_ALIASES: Readonly<Record<string, string>> = { cmpd: 'cpd', cmpx: 'cpx', cmpy: 'cpy', lda: 'ldaa', sta: 'staa', ora: 'oraa', ldb: 'ldab', stb: 'stab', orb: 'orab' }
export const hc11InstructionLink = preferInstructionLinks(name => hc11InstructionLinkHtml(HC11_HTML_ALIASES[name.toLowerCase()] ?? name), hc11InstructionLinkFallback)

export const m6809InstructionLink = preferInstructionLinks(m6809InstructionLinkHtml, m6809InstructionLinkFallback)
