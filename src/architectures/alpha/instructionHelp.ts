import { htmlInstructionLink } from './htmlReferences'
import { preferInstructionLinks, instructionHelpGroups, instructionLinks } from '../../core/instructionHelp'
import { instructions } from './isa'

export const instructionHelp = instructionHelpGroups([
	['lda ldah', '$rA,displacement($rB)', 'Add a signed 16-bit displacement, or that displacement shifted left 16 bits, to a base register. $31 supplies zero; no memory is read.'],
	['ldl ldq', '$rA,displacement($rB)', 'Load an aligned 32-bit longword or 64-bit quadword from little-endian memory. LDL sign-extends its result to 64 bits.'],
	['ldbu ldwu', '$rA,displacement($rB)', 'Load an unsigned byte or word using Alpha byte/word-extension encodings.'],
	['stl stq stb stw', '$rA,displacement($rB)', 'Store the low 32, 64, 8 or 16 bits of a register to little-endian memory; multibyte aligned forms enforce native alignment.'],
	['ldq_u stq_u', '$rA,displacement($rB)', 'Load or store the aligned quadword containing the effective address; the low three address bits are ignored.'],
	['addl subl', '$rA,$rB|literal8,$rC', 'Add or subtract low 32-bit signed operands, wrap the longword result and sign-extend it to 64 bits.'],
	['addq subq', '$rA,$rB|literal8,$rC', 'Add or subtract 64-bit operands with quadword wrapping.'],
	['s4addl s8addl s4subl s8subl', '$rA,$rB|literal8,$rC', 'Scale the first operand by four or eight, then add or subtract the second; sign-extend the low longword result.'],
	['s4addq s8addq s4subq s8subq', '$rA,$rB|literal8,$rC', 'Scale the first operand by four or eight, then add or subtract the second using 64-bit arithmetic.'],
	['mull mulq', '$rA,$rB|literal8,$rC', 'Multiply operands and retain the low signed longword or quadword result; MULL sign-extends its 32-bit result.'],
	['umulh', '$rA,$rB|literal8,$rC', 'Return the high 64 bits of the unsigned 128-bit product.'],
	['cmpeq cmplt cmple cmpult cmpule', '$rA,$rB|literal8,$rC', 'Compare equality, signed less/less-or-equal or unsigned less/less-or-equal; write 0 or 1 to the destination. Alpha has no integer condition-code register.'],
	['cmpbge', '$rA,$rB|literal8,$rC', 'Compare corresponding unsigned bytes; result bit i is set when byte i of the first source is greater than or equal to byte i of the second source.'],
	['and bic', '$rA,$rB|literal8,$rC', 'AND the first source with the second source, or its complement for BIC.'],
	['bis ornot', '$rA,$rB|literal8,$rC', 'OR the first source with the second source, or its complement for ORNOT.'],
	['xor eqv', '$rA,$rB|literal8,$rC', 'Compute 64-bit XOR or equivalence (complemented XOR).'],
	['sll srl sra', '$rA,$rB|literal8,$rC', 'Shift a quadword left, logically right or arithmetically right by the low six count bits.'],
	['cmovlbs cmovlbc cmoveq cmovne cmovlt cmovge cmovle cmovgt', '$rA,$rB|literal8,$rC', 'Copy the second source only if the first source satisfies the named low-bit, zero or signed comparison condition. Otherwise leave the destination unchanged.'],
	['zap zapnot', '$rA,$rB|literal8,$rC', 'Clear selected byte lanes (ZAP) or all unselected byte lanes (ZAPNOT) according to the low eight mask bits.'],
	['extbl extwl extll extql', '$rA,$rB|literal8,$rC', 'Extract a byte, word, longword or quadword from the low portion of a shifted register using the low three position bits.'],
	['insbl inswl insll insql', '$rA,$rB|literal8,$rC', 'Insert the low byte, word, longword or quadword into the selected low-order byte position.'],
	['mskbl mskwl mskll mskql', '$rA,$rB|literal8,$rC', 'Clear the low-part byte lanes corresponding to a byte, word, longword or quadword positioned by the low three position bits.'],
	['br bsr', '$rA,target', 'Save the next PC in the link register and branch using a signed PC-relative word displacement. BSR denotes a subroutine call; $31 discards the link.'],
	['beq bne blt ble bge bgt', '$rA,target', 'Branch when the signed 64-bit register is equal/not equal to zero, less/less-or-equal to zero, or greater/greater-or-equal to zero.'],
	['blbc blbs', '$rA,target', 'Branch when the low bit of the register is clear or set.'],
	['jmp jsr ret jsr_coroutine', '[$rA,]($rB)[,hint]', 'Jump through a register and save the next PC in the link destination. JSR/RET/JSR_COROUTINE supply architectural branch-prediction hints; THRAX tracks actual calls and returns.'],
	['call_pal', 'function', 'Invoke a PALcode function. The educational environment handles HALT (0) and CALLSYS (0x83); CALLSYS uses $0 for the service and input result, and $16 for an output argument. Other PALcode environments are not emulated.'],
	['trapb excb mb wmb', '', 'Execute a trap, exception or memory-ordering barrier. The functional single-core simulator has no outstanding speculative or concurrent operations.'],
	['mov', '$source,$destination', 'Copy an integer register; a BIS alias.'],
	['clr', '$destination', 'Clear a register; a BIS alias using $31 as both sources.'],
	['nop', '', 'Discard the result of a no-op BIS using $31.'],
	['not', '$source,$destination', 'Complement a 64-bit integer register; an ORNOT alias.'],
	['negl negq', '$source,$destination', 'Negate a longword or quadword by subtracting it from $31; NEGL sign-extends the low 32-bit result.'],
	['lds sts', '$fA,displacement($rB)', 'Load or store an aligned IEEE S_floating longword. Registers hold S values in T layout: LDS widens the 8-bit exponent to 11 bits and STS keeps register bits <63:62> and <58:29>.'],
	['ldt stt', '$fA,displacement($rB)', 'Load or store an aligned IEEE T_floating (or quadword integer) value unchanged.'],
	['adds subs muls divs', '$fA,$fB,$fC', 'Add, subtract, multiply or divide IEEE single-precision values, rounding to S_floating and writing the result in register (T) layout.'],
	['addt subt mult divt', '$fA,$fB,$fC', 'Add, subtract, multiply or divide IEEE double-precision T_floating values.'],
	['sqrts sqrtt', '$fB,$fC', 'Square root of an S_floating or T_floating value (FIX extension).'],
	['cmptun cmpteq cmptlt cmptle', '$fA,$fB,$fC', 'Compare T_floating values; write 2.0 when unordered, equal, less, or less-or-equal, else 0.0. CMPTLT and CMPTLE with a NaN are invalid operations.'],
	['cvtts', '$fB,$fC', 'Round a T_floating value to S_floating.'],
	['cvtst', '$fB,$fC', 'Widen an S_floating value to T_floating exactly; /S enables software completion.'],
	['cvttq', '$fB,$fC', 'Convert T_floating to a 64-bit integer in a float register. Plain CVTTQ rounds to nearest; /C truncates. Overflow keeps the low 64 bits and sets IOV.'],
	['cvtqs cvtqt', '$fB,$fC', 'Convert the 64-bit integer in a float register to S_floating or T_floating with rounding.'],
	['cpys cpysn cpyse', '$fA,$fB,$fC', 'Copy the sign of the first operand (CPYS), its complement (CPYSN) or its sign and exponent (CPYSE) onto the rest of the second operand.'],
	['fcmoveq fcmovne fcmovlt fcmovge fcmovle fcmovgt', '$fA,$fB,$fC', 'Copy the second operand when the first satisfies the named test against zero; -0.0 counts as zero. Otherwise leave the destination unchanged.'],
	['fbeq fbne fblt fbge fble fbgt', '$fA,target', 'Branch when the floating-point register satisfies the named test against zero; -0.0 counts as zero.'],
	['mf_fpcr mt_fpcr', '$fA', 'Copy the floating-point control register to or from a float register: dynamic rounding mode, sticky exception status and trap disables.'],
	['itofs itoft', '$rA,$fC', 'Move an integer register to a float register, as LDS (S) or unchanged (T) would load it (FIX extension).'],
	['ftois ftoit', '$fA,$rC', 'Move a float register to an integer register, as STS would store it, sign extended (S), or unchanged (T) (FIX extension).'],
	['fmov', '$fA,$fC', 'Copy a float register; a CPYS alias.'],
	['fneg', '$fA,$fC', 'Negate a float register by complementing its sign; a CPYSN alias.'],
	['fabs', '$fA,$fC', 'Clear the sign of a float register; a CPYS alias with $f31.'],
	['fclr', '$fC', 'Clear a float register; a CPYS alias.'],
	['fnop', '', 'Floating-point no-op; a CPYS alias writing $f31.'],
])
const ROUNDING: Record<string, string> = { c: 'chopped (toward zero)', m: 'toward minus infinity', d: 'the FPCR dynamic mode' }
const TRAPS: Record<string, string> = { u: 'underflow trap enabled', v: 'integer overflow trap enabled', s: 'software completion', su: 'software completion, underflow trap enabled', sv: 'software completion, integer overflow trap enabled', sui: 'software completion, underflow and inexact traps enabled', svi: 'software completion, integer overflow and inexact traps enabled' }
for (const name of instructions) if (name.endsWith('/v') && !name.startsWith('cvt')) {
	const base = instructionHelp[name.slice(0, -2)]
	if (base) instructionHelp[name] = { ...base, syntax: base.syntax.replace(/^\S+/, name.toUpperCase()), details: ['The /V form traps on signed integer overflow instead of silently wrapping.'] }
} else if (name.includes('/')) {
	const [mnemonic, qualifier] = name.split('/'), base = instructionHelp[mnemonic]
	const round = /[cmd]$/.test(qualifier) ? qualifier.slice(-1) : '', trap = qualifier.slice(0, qualifier.length - round.length)
	const parts = [...round ? [`rounding ${ROUNDING[round]}`] : [], ...trap ? [TRAPS[trap]] : []]
	if (base) instructionHelp[name] = { ...base, syntax: base.syntax.replace(/^\S+/, name.toUpperCase()), details: [`/${qualifier.toUpperCase()}: ${parts.join('; ')}.`] }
}

// VaxHaven's DEC documentation archive, filed by part number EC-QD2KC-TE.
// Mirrors: https://www.ece.lsu.edu/ee4720/alphav4.pdf (byte-identical)
// Mirrors: http://www.o3one.org/hwdocs/alpha/alphaahb.pdf (byte-identical; HTTP only)
export const reference = 'https://vaxhaven.com/images/7/7e/EC-QD2KC-TE.pdf'
// Alpha Architecture Handbook V4 PDF pages; BIS, SUB and CPYS idioms open their base instruction.
const handbookPages = new Map(Object.entries({
	61: 'lda ldah', 62: 'ldl ldq ldbu ldwu', 64: 'ldq_u', 71: 'stl stq stb stw', 73: 'stq_u',
	76: 'beq bne blt ble bge bgt blbc blbs', 77: 'br bsr', 78: 'jmp jsr ret jsr_coroutine',
	81: 'addl', 82: 's4addl s8addl', 83: 'addq', 84: 's4addq s8addq', 85: 'cmpeq cmplt cmple', 86: 'cmpult cmpule',
	90: 'mull', 91: 'mulq', 92: 'umulh', 93: 'subl negl', 94: 's4subl s8subl', 95: 'subq negq', 96: 's4subq s8subq',
	98: 'and bic bis ornot xor eqv mov clr nop not', 99: 'cmovlbs cmovlbc cmoveq cmovne cmovlt cmovge cmovle cmovgt',
	101: 'sll srl', 102: 'sra', 105: 'cmpbge', 107: 'extbl extwl extll extql', 111: 'insbl inswl insll insql',
	113: 'mskbl mskwl mskll mskql', 117: 'zap zapnot', 149: 'lds', 150: 'ldt', 153: 'sts', 154: 'stt',
	156: 'fbeq fbne fblt fbge fble fbgt', 161: 'cpys cpysn cpyse fmov fneg fabs fclr fnop',
	163: 'fcmoveq fcmovne fcmovlt fcmovge fcmovle fcmovgt', 165: 'mf_fpcr mt_fpcr', 167: 'adds addt',
	169: 'cmptun cmpteq cmptlt cmptle', 173: 'cvttq', 174: 'cvtqs cvtqt', 175: 'cvtst', 176: 'cvtts', 178: 'divs divt',
	179: 'ftois ftoit', 180: 'itofs itoft', 183: 'muls mult', 185: 'sqrts sqrtt', 187: 'subs subt',
	191: 'call_pal', 194: 'excb', 198: 'mb', 200: 'trapb', 203: 'wmb',
}).flatMap(([page, names]) => names.split(' ').map((name) => [name, Number(page)] as const)))
/** Qualified forms such as ADDT/SUI share their base instruction's page. */
const instructionLinkFallback = instructionLinks(reference, (name) => handbookPages.get(name.split('/')[0]))
export const instructionLink = preferInstructionLinks(name => htmlInstructionLink(name.split('/')[0]), instructionLinkFallback)
