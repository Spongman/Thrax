import { instructionLinks } from '../../../core/instructionHelp'

export const htmlReference = 'https://www.riscos.com/support/developers/asm/instrset.html'
export const htmlInstructionLink = instructionLinks(htmlReference, Object.fromEntries([
	['b bl', '#87420'],
	['and eor sub rsb add adc sbc rsc tst teq cmp cmn orr mov bic mvn lsl asl lsr asr ror rrx neg nop', '#39219'],
	['mul mla', '#57266'],
	['ldr str ldrb strb', '#10903'],
	['ldm stm push pop', '#70501'],
	['swp', '#41730'],
	['swi svc', '#36610'],
	['mrc mcr', '#53274'],
	['adr', '#marker-846828'],
].flatMap(([names, target]) => names.split(' ').map(name => [name, target]))))
