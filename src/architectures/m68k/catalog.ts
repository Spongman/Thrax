import { htmlInstructionLink as integerHtmlLink, htmlReference as integerHtmlReference } from './integerHtmlReferences'
import { htmlInstructionLink as fpHtmlLink, htmlReference as fpHtmlReference } from './fpuHtmlReferences'
import { FP_CONDITIONS } from './fpuIsa'
import { instructionCatalog, instructionLinks, preferInstructionLinks, type InstructionHelp, type InstructionTable } from '../../core/instructionHelp'
export const CONDITIONS = ['t', 'f', 'hi', 'ls', 'cc', 'cs', 'ne', 'eq', 'vc', 'vs', 'pl', 'mi', 'ge', 'lt', 'gt', 'le']

const REFERENCE = 'https://www.nxp.com/docs/en/reference-manual/M68000PRM.pdf'
// Each instruction's first PDF page in the Programmer's Reference Manual, integer (section 4) and FPU (section 5).
const PAGES: Readonly<Record<string, number>> = {
	add: 108, adda: 111, addi: 113, addq: 115, and: 119, andi: 122, asl: 125, asr: 125, bcc: 130, bchg: 131, bclr: 134, bkpt: 157,
	bra: 159, bset: 160, bsr: 163, btst: 165, clr: 177, cmp: 179, cmpa: 181, cmpi: 183, dbcc: 194, dbra: 194, divs: 196, divu: 200,
	eor: 204, eori: 206, exg: 209, ext: 210, extb: 210, illegal: 211, jmp: 212, jsr: 213, lea: 214, link: 215, lsl: 217, lsr: 217,
	move: 220, movea: 223, movem: 232, moveq: 238, muls: 239, mulu: 242, neg: 247, nop: 251, not: 252, or: 254, ori: 257, pea: 263,
	rol: 264, ror: 264, roxl: 267, roxr: 267, rtd: 270, rts: 273, scc: 276, sub: 278, suba: 281, subi: 283, subq: 285, swap: 289,
	trap: 292, tst: 296, unlk: 298,
	fabs: 306, facos: 310, fadd: 313, fasin: 316, fatan: 319, fatanh: 322, fbcc: 325, fcmp: 327, fcos: 330, fcosh: 333, fdbcc: 336,
	fdbra: 336, fdiv: 338, fetox: 342, fetoxm1: 345, fgetexp: 348, fgetman: 351, fint: 354, fintrz: 357, flog10: 360, flog2: 363,
	flogn: 366, flognp1: 369, fmod: 372, fmove: 375, fmovecr: 385, fmovem: 387, fmul: 396, fneg: 400, fnop: 404, frem: 406,
	fscale: 409, fscc: 412, fsgldiv: 414, fsglmul: 417, fsin: 420, fsincos: 423, fsinh: 427, fsqrt: 430, fsub: 434, ftan: 438,
	ftanh: 441, ftentox: 444, ftrapcc: 447, ftst: 449, ftwotox: 452,
}
// Conditional families (BEQ, FDBNGT) share their Bcc-style page.
const FAMILIES = [['fdb', FP_CONDITIONS], ['ftrap', FP_CONDITIONS], ['fb', FP_CONDITIONS], ['fs', FP_CONDITIONS], ['db', CONDITIONS], ['b', CONDITIONS], ['s', CONDITIONS]] as const
const pdfLink = instructionLinks(REFERENCE, (name) => PAGES[name] ?? FAMILIES.flatMap(([prefix, conditions]) =>
	name.startsWith(prefix) && conditions.includes(name.slice(prefix.length)) ? [PAGES[`${prefix}cc`]] : [])[0])
const DOCS: InstructionTable = {
	move: ['source, destination', 'Copy a byte, word or longword; set N and Z and clear V and C.'],
	movea: ['source, An', 'Load an address register without changing flags; word sources are sign-extended.'],
	moveq: ['#imm8, Dn', 'Sign-extend an 8-bit immediate into a data register; set N and Z and clear V and C.'],
	movem: ['register-list, address | address, register-list', 'Transfer multiple registers to or from memory in architectural register order.'],
	lea: ['address, An', 'Compute an effective address without reading memory or changing flags.'],
	pea: ['address', 'Push an effective address as a longword onto the stack.'],
	add: ['source, destination', 'Add source to destination; update X, N, Z, V and C.'],
	sub: ['source, destination', 'Subtract source from destination; update X, N, Z, V and C.'],
	cmp: ['source, Dn', 'Compare by subtracting source from Dn; set N, Z, V and C without storing a result.'],
	adda: ['source, An', 'Add to an address register without changing flags; word sources are sign-extended.'],
	suba: ['source, An', 'Subtract from an address register without changing flags; word sources are sign-extended.'],
	cmpa: ['source, An', 'Compare against a 32-bit address register; word sources are sign-extended.'],
	and: ['source, destination', 'Bitwise AND; set N and Z and clear V and C.'],
	or: ['source, destination', 'Bitwise OR; set N and Z and clear V and C.'],
	eor: ['Dn, destination', 'Bitwise exclusive OR; set N and Z and clear V and C.'],
	addi: ['#immediate, destination', 'Add an immediate value, updating arithmetic flags.'],
	subi: ['#immediate, destination', 'Subtract an immediate value, updating arithmetic flags.'],
	cmpi: ['#immediate, destination', 'Compare with an immediate value; leave the destination unchanged.'],
	andi: ['#immediate, destination', 'AND an immediate value into the destination.'],
	ori: ['#immediate, destination', 'OR an immediate value into the destination.'],
	eori: ['#immediate, destination', 'Exclusive OR an immediate value into the destination.'],
	addq: ['#1..8, destination', 'Add a quick constant; address-register destinations do not change flags.'],
	subq: ['#1..8, destination', 'Subtract a quick constant; address-register destinations do not change flags.'],
	clr: ['destination', 'Clear the operand; set Z and clear N, V and C.'],
	tst: ['source', 'Set N and Z from the operand and clear V and C, without changing the operand.'],
	neg: ['destination', 'Negate the operand using two’s complement, updating arithmetic flags.'],
	not: ['destination', 'Complement every bit; set N and Z and clear V and C.'],
	swap: ['Dn', 'Exchange the upper and lower 16-bit halves; set N and Z and clear V and C.'],
	exg: ['register, register', 'Exchange two data or address registers without changing flags.'],
	ext: ['Dn', 'Sign-extend a byte to a word (.w) or a word to a longword (.l).'],
	extb: ['Dn', 'Sign-extend a byte to a longword. Requires MC68020 or later.', ['68020']],
	muls: ['source, Dn', 'Multiply signed 16-bit operands into a 32-bit product.'],
	mulu: ['source, Dn', 'Multiply unsigned 16-bit operands into a 32-bit product.'],
	divs: ['source, Dn', 'Divide a signed 32-bit dividend by a signed 16-bit divisor; pack remainder above quotient.'],
	divu: ['source, Dn', 'Divide an unsigned 32-bit dividend by an unsigned 16-bit divisor; pack remainder above quotient.'],
	asl: ['count, Dn | address', 'Shift left arithmetically; update carry, extend and overflow. Memory forms shift a word once.'],
	asr: ['count, Dn | address', 'Shift right arithmetically, retaining the sign bit and updating carry and extend.'],
	lsl: ['count, Dn | address', 'Shift left logically, inserting zeros and updating carry and extend.'],
	lsr: ['count, Dn | address', 'Shift right logically, inserting zeros and updating carry and extend.'],
	rol: ['count, Dn | address', 'Rotate left within the operand; leave X unchanged.'],
	ror: ['count, Dn | address', 'Rotate right within the operand; leave X unchanged.'],
	roxl: ['count, Dn | address', 'Rotate left through the extend flag X.'],
	roxr: ['count, Dn | address', 'Rotate right through the extend flag X.'],
	btst: ['bit, destination', 'Test a bit and set Z if it was clear. Bit numbers wrap modulo 32 for registers, 8 for memory.'],
	bchg: ['bit, destination', 'Test a bit into Z, then complement that bit.'],
	bclr: ['bit, destination', 'Test a bit into Z, then clear that bit.'],
	bset: ['bit, destination', 'Test a bit into Z, then set that bit.'],
	bra: ['target', 'Branch unconditionally to target.'],
	bsr: ['target', 'Branch to a subroutine, pushing the return address.'],
	jmp: ['address', 'Jump to an effective address.'],
	jsr: ['address', 'Push the return address and jump to an effective address.'],
	rts: ['', 'Pop a longword return address from the stack into PC.'],
	rtd: ['#displacement', 'Return and release displacement bytes of stack arguments. Requires MC68010 or later.', ['68010', '68020']],
	link: ['An, #displacement', 'Save An, establish a stack frame in An, then adjust SP.'],
	unlk: ['An', 'Release a stack frame and restore its saved address register.'],
	trap: ['#vector', 'Invoke a software trap; the simulator provides teaching console services through TRAP #15.'],
	nop: ['', 'Do nothing.'],
	illegal: ['', 'Execute the illegal-instruction trap opcode.'],
	bkpt: ['#number', 'Software breakpoint numbered 0–7. Requires MC68010 or later.', ['68010', '68020']],
	dbra: ['Dn, target', 'Decrement the low word of Dn; branch unless it becomes 0xFFFF. Flags are unchanged.'],
}
const PREDICATES = ['always', 'never', 'unsigned higher (C = 0 and Z = 0)', 'unsigned lower or same (C = 1 or Z = 1)',
	'carry clear (C = 0)', 'carry set (C = 1)', 'not equal (Z = 0)', 'equal (Z = 1)', 'overflow clear (V = 0)',
	'overflow set (V = 1)', 'plus (N = 0)', 'minus (N = 1)', 'signed greater or equal (N = V)',
	'signed less (N ≠ V)', 'signed greater (Z = 0 and N = V)', 'signed less or equal (Z = 1 or N ≠ V)']
const conditional: InstructionTable = Object.fromEntries(CONDITIONS.flatMap((cc, index) => [
	[`b${cc}`, ['target', `Branch when ${PREDICATES[index]}.`]],
	[`db${cc}`, ['Dn, target', `If the condition (${PREDICATES[index]}) is false, decrement the low word of Dn and branch unless it becomes 0xFFFF. Flags are unchanged.`]],
	[`s${cc}`, ['destination', `Write 0xFF if the condition (${PREDICATES[index]}) is true, otherwise write 0. Flags are unchanged.`]],
]))
const htmlLink = (name: string) => integerHtmlLink(name === 'dbra' ? 'dbcc' : name) ?? fpHtmlLink(name === 'fdbra' ? 'fdbcc' : name) ?? FAMILIES.flatMap(([prefix, conditions]) =>
	name.startsWith(prefix) && conditions.includes(name.slice(prefix.length)) ? [integerHtmlLink(`${prefix}cc`) ?? fpHtmlLink(`${prefix}cc`)] : [])[0]
const link = preferInstructionLinks(htmlLink, pdfLink)


export const M68K_INSTRUCTIONS = instructionCatalog({ ...conditional, ...DOCS }, integerHtmlReference, link)

const monadic = (summary: string) => ['<ea>, FPn | FPm, FPn | FPn', `${summary} Rounds to the FPCR precision and sets the FPSR condition codes.`] as const
const dyadic = (summary: string) => ['<ea>, FPn | FPm, FPn', `${summary} Rounds to the FPCR precision and sets the FPSR condition codes.`] as const
const transcendental = (summary: string) => monadic(`${summary} Evaluated in IEEE double precision (about 53 bits) here.`)
const FPU_DOCS: InstructionTable = {
	fmove: ['<ea>, FPn | FPm, FPn | FPn, <ea>{#k} | <ea>, FPcr | FPcr, <ea>', 'Move and convert between B/W/L/S/D/X/P formats and FP registers, or move one control register (FPCR, FPSR, FPIAR).'],
	fmovem: ['FP-list | Dn, <ea> | <ea>, FP-list | Dn | FPcr-list, <ea> | <ea>, FPcr-list', 'Move several FP registers in 96-bit extended format, or several control registers, without changing the FPSR.'],
	fmovecr: ['#offset, FPn', 'Load a constant ROM value: $00 pi, $0B log10(2), $0C e, $0D log2(e), $0E log10(e), $0F 0.0, $30 ln(2), $31 ln(10), $32-$3F 10^0 to 10^4096.'],
	fadd: dyadic('Add the source to FPn.'),
	fsub: dyadic('Subtract the source from FPn.'),
	fmul: dyadic('Multiply FPn by the source.'),
	fdiv: dyadic('Divide FPn by the source.'),
	fsglmul: dyadic('Multiply, rounding the result to single precision whatever FPCR selects.'),
	fsgldiv: dyadic('Divide, rounding the result to single precision whatever FPCR selects.'),
	fmod: dyadic('Remainder of FPn / source with the quotient truncated toward zero; FPSR keeps the quotient sign and low 7 bits.'),
	frem: dyadic('IEEE remainder of FPn / source with the quotient rounded to nearest even; FPSR keeps the quotient sign and low 7 bits.'),
	fscale: dyadic('Multiply FPn by 2 raised to the integer part of the source.'),
	fcmp: ['<ea>, FPn | FPm, FPn', 'Compare FPn with the source and set the FPSR condition codes N, Z and NAN; FPn is unchanged.'],
	ftst: ['<ea> | FPn', 'Set the FPSR condition codes N, Z, I and NAN from the operand.'],
	fabs: monadic('Absolute value.'),
	fneg: monadic('Negate.'),
	fsqrt: monadic('Square root; a negative operand is an operand error.'),
	fint: monadic('Round to an integer using the FPCR rounding mode.'),
	fintrz: monadic('Round to an integer toward zero.'),
	fgetexp: monadic('The unbiased binary exponent as a floating-point integer.'),
	fgetman: monadic('The mantissa scaled to 1.0 <= |x| < 2.0, keeping the sign.'),
	fsin: transcendental('Sine of radians.'),
	fcos: transcendental('Cosine of radians.'),
	ftan: transcendental('Tangent of radians.'),
	fasin: transcendental('Arc sine.'),
	facos: transcendental('Arc cosine.'),
	fatan: transcendental('Arc tangent.'),
	fsinh: transcendental('Hyperbolic sine.'),
	fcosh: transcendental('Hyperbolic cosine.'),
	ftanh: transcendental('Hyperbolic tangent.'),
	fatanh: transcendental('Hyperbolic arc tangent.'),
	fetox: transcendental('e to the power of the source.'),
	fetoxm1: transcendental('e to the power of the source, minus 1.'),
	ftwotox: transcendental('2 to the power of the source.'),
	ftentox: transcendental('10 to the power of the source.'),
	flogn: transcendental('Natural logarithm.'),
	flognp1: transcendental('Natural logarithm of 1 plus the source.'),
	flog10: transcendental('Base 10 logarithm.'),
	flog2: transcendental('Base 2 logarithm.'),
	fsincos: ['<ea>, FPc:FPs | FPm, FPc:FPs', 'Sine into FPs and cosine into FPc. Evaluated in IEEE double precision (about 53 bits) here.'],
	fnop: ['', 'Synchronize with the coprocessor; no operation.'],
	fdbra: ['Dn, target', 'FDBF: decrement the low word of Dn and branch unless it becomes 0xFFFF.'],
}
const FP_PREDICATES = ['never', 'equal', 'ordered greater than', 'ordered greater or equal', 'ordered less than',
	'ordered less or equal', 'ordered greater or less', 'ordered', 'unordered', 'unordered or equal',
	'unordered or greater', 'unordered or greater or equal', 'unordered or less', 'unordered or less or equal', 'not equal', 'always']
const fpConditional: InstructionTable = Object.fromEntries(FP_CONDITIONS.flatMap((cc, index) => {
	const predicate = `${FP_PREDICATES[index & 15]}${index & 16 ? '; signals BSUN when the result is unordered (NaN)' : ''}`
	return [
		[`fb${cc}`, ['target', `Branch when the FPSR predicate holds: ${predicate}.`]],
		[`fdb${cc}`, ['Dn, target', `If the predicate (${predicate}) is false, decrement the low word of Dn and branch unless it becomes 0xFFFF.`]],
		[`fs${cc}`, ['<ea>', `Write 0xFF if the predicate (${predicate}) holds, otherwise 0.`]],
		[`ftrap${cc}`, ['[#data]', `Trap when the predicate (${predicate}) holds; exception processing is not simulated, so a taken trap stops execution.`]],
	]
}))
export const FPU_INSTRUCTIONS = instructionCatalog({ ...fpConditional, ...FPU_DOCS }, fpHtmlReference, link)
export const FPU_MNEMONICS = FPU_INSTRUCTIONS.names()
export const MNEMONICS = M68K_INSTRUCTIONS.names()

export function m68kInstructionHelp(mnemonic: string): InstructionHelp | null {
	const name = mnemonic.toLowerCase().replace(/\.[bwlsdxp]$/, '')
	const help = M68K_INSTRUCTIONS.help(name) ?? FPU_INSTRUCTIONS.help(name)
	if (help) help.contents[0] = help.contents[0].replace(new RegExp(`(^\\*\\*\\[?|Open )${name.toUpperCase()}\\b`, 'g'), `$1${mnemonic.toUpperCase()}`)
	return help
}
