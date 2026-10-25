import { htmlInstructionLink } from './htmlReferences'
import { instructionHelpGroups, instructionLinks, preferInstructionLinks } from '../../core/instructionHelp'
import { branches, instructions, reference } from './isa'
import { fbranches } from './fpu'

export const instructionHelp = instructionHelpGroups([
	['add addx', '%rs1, %rs2|simm13, %rd', 'Add two 32-bit operands; ADDX also adds ICC.C. The result wraps to 32 bits.'],
	['sub subx', '%rs1, %rs2|simm13, %rd', 'Subtract the second operand from the first. SUBX also subtracts ICC.C, which represents borrow on SPARC.'],
	['and andn or orn xor xnor', '%rs1, %rs2|simm13, %rd', 'Perform the named bitwise operation. ANDN/ORN complement the second operand; XNOR complements XOR.'],
	['umul smul', '%rs1, %rs2|simm13, %rd', 'Multiply unsigned or signed 32-bit operands. Write the low product to rd and the high product to Y.'],
	['udiv sdiv', '%rs1, %rs2|simm13, %rd', 'Divide the unsigned or signed 64-bit Y:rs1 dividend by a 32-bit divisor. Saturate an overflowing quotient; division by zero faults atomically.'],
	['sll srl sra', '%rs1, %rs2|shift5, %rd', 'Shift left, logically right or arithmetically right. Register counts use five low bits; immediate counts must fit 0 through 31.'],
	['sethi', 'imm22|%hi(expression), %rd', 'Place an unsigned 22-bit immediate into bits 31:10 and clear the low ten bits. NOP is SETHI 0,%g0.'],
	['set', 'constant32, %rd', 'Load a 32-bit constant using SETHI plus OR. This pseudo always emits two native words with separate debugger source rows; do not place it in one delay slot.'],
	['ld ldub lduh ldsb ldsh', '[%rs1 + %rs2|simm13], %rd', 'Load a big-endian word, unsigned byte/halfword, or sign-extended byte/halfword. Halfwords and words require natural alignment.'],
	['ldd', '[%rs1 + %rs2|simm13], %rd', 'Load two big-endian words into an even register pair. The address must be eight-byte aligned.'],
	['st stb sth', '%rs, [%rs1 + %rs2|simm13]', 'Store the low word, byte or halfword in big-endian memory. Multibyte stores require natural alignment.'],
	['std', '%rs, [%rs1 + %rs2|simm13]', 'Store an even register pair as two big-endian words at an eight-byte-aligned address.'],
	['ldstub swap', '[%rs1 + %rs2|simm13], %rd', 'Read a byte and replace it with FF (LDSTUB), or exchange a word with rd (SWAP). Each operation is atomic in this single-core functional simulator.'],
	['call', 'target', 'Write this instruction’s PC to %o7, execute the delay instruction, then branch to the PC-relative target. The conventional return address is %o7+8.'],
	['jmpl', '%rs1 + %rs2|simm13, %rd', 'Write the current PC to rd and select an aligned indirect target after the delay instruction. Using %o7 as rd is tracked as a call.'],
	['jmp', '%rs1 + %rs2|simm13', 'Jump indirectly after the delay instruction; a JMPL alias that discards the link in %g0.'],
	['ret retl', '', 'Return through %i7+8 (RET) or %o7+8 (RETL). The delay instruction still executes; the common call frame closes after that instruction.'],
	['save restore', '[%rs1, %rs2|simm13, %rd]', 'Add operands from the old window, rotate CWP down (SAVE) or up (RESTORE), and write rd in the new window. A masked WIM window faults; native overflow/underflow handlers are not modeled.'],
	['rd', '%y, %rd', 'Read the unprivileged multiply/divide Y register. Other ancillary and privileged special registers are outside this core’s native instruction subset.'],
	['wr', '%rs1, %rs2|simm13, %y', 'Write the XOR of the operands into Y. This is useful for setting the high dividend before division.'],
	['flush', '%rs1 + %rs2|simm13', 'Flush instruction memory at an effective address. The functional core has coherent decode invalidation and no separate hardware instruction cache.'],
	['stbar', '', 'Store barrier. The single-core functional core completes stores in instruction order.'],
	['nop', '', 'Execute SETHI 0,%g0 with no integer-register effect.'],
	['mov', '%rs|simm13, %rd', 'Copy a register or signed 13-bit immediate using OR with %g0.'],
	['clr', '%rd', 'Clear a register using OR with %g0. Writes to %g0 are discarded.'],
	['cmp', '%rs1, %rs2|simm13', 'Set ICC from subtraction while discarding the result in %g0. Carry means unsigned borrow.'],
	['tst', '%rs', 'Set ICC.N/Z from a register using ORcc, clear V/C, and discard the result.'],
	['not neg', '%rs[, %rd]', 'Complement or negate a register; omit rd to update the source. These aliases leave ICC unchanged.'],
	['inc dec inccc deccc', '[simm13,] %rd', 'Add or subtract the constant, defaulting to one. The CC aliases update integer condition codes.'],
	['btst', '%rs|simm13, %rs1', 'Test the mask against rs1 through ANDcc and discard the result.'],
	['bset bclr btog', '%rs|simm13, %rd', 'Set, clear or toggle selected bits of rd through OR, ANDN or XOR.'],
])
const conditions = ['never', 'equal (Z)', 'signed less or equal (Z or N differs from V)', 'signed less (N differs from V)', 'unsigned less or equal (C or Z)', 'carry set / unsigned less (C)', 'negative (N)', 'overflow set (V)', 'always', 'not equal (not Z)', 'signed greater (not Z and N equals V)', 'signed greater or equal (N equals V)', 'unsigned greater (not C and not Z)', 'carry clear / unsigned greater or equal (not C)', 'positive or zero (not N)', 'overflow clear (not V)']
for (let i = 0; i < branches.length; i++) {
	const name = branches[i]
	instructionHelp[name] = { syntax: `${name.toUpperCase()} target`, description: `Branch when ${conditions[i]}. Execute the delay instruction before selecting the target or fall-through.` }
	instructionHelp[`${name},a`] = { syntax: `${name.toUpperCase()},A target`, description: `Branch when ${conditions[i]}. Annul the delay instruction if not taken; BA,A annuls its delay instruction even when taken.` }
	const trap = `t${name.slice(1)}`
	instructionHelp[trap] = { syntax: `${trap.toUpperCase()} %rs1 + %rs2|imm7`, description: `Trap when ${conditions[i]}. THRAX intercepts trap 0x10 for an educational monitor: %g1 selects 1 print integer, 4 print string, 5 read integer, 10 exit or 11 print character; %o0 supplies the argument or input result. Other taken traps fault.` }
}
for (const [alias, base] of Object.entries({ bz: 'be', bnz: 'bne', blu: 'bcs', bgeu: 'bcc' })) for (const suffix of ['', ',a']) instructionHelp[alias + suffix] = { ...instructionHelp[base + suffix], syntax: `${(alias + suffix).toUpperCase()} target` }
for (const name of instructions) if (name.endsWith('cc') && !instructionHelp[name]) {
	const base = instructionHelp[name.slice(0, -2)]
	if (base) instructionHelp[name] = { ...base, syntax: base.syntax.replace(/^\S+/, name.toUpperCase()), details: ['Update ICC.N/Z/V/C. Logical operations and multiply clear V/C; divide sets V on a saturated quotient.'] }
}

const fpHelp: [string, string, string][] = [
	['fadds fsubs fmuls fdivs', '%fs1, %fs2, %fd', 'Add, subtract, multiply or divide IEEE single values, rounded by FSR.RD. Sets FSR.cexc and accumulates aexc; an exception enabled in FSR.TEM faults without writing rd.'],
	['faddd fsubd fmuld fdivd', '%fs1, %fs2, %fd', 'Add, subtract, multiply or divide IEEE doubles held in even/odd register pairs (high word in the even register), rounded by FSR.RD.'],
	['fsmuld', '%fs1, %fs2, %fd', 'Multiply two singles into an exact double in an even/odd pair.'],
	['fsqrts fsqrtd', '%fs2, %fd', 'Square root of a single or double. A negative nonzero operand is invalid and yields the default NaN.'],
	['fmovs fnegs fabss', '%fs2, %fd', 'Copy a single register, flipping (FNEGs) or clearing (FABSs) the sign bit. No exceptions; clears cexc. Move doubles with two FMOVs.'],
	['fitos fitod', '%fs2, %fd', 'Convert a signed 32-bit integer held in an FP register to single or double, rounded by FSR.RD. Move integers through memory with ST and LD.'],
	['fstoi fdtoi', '%fs2, %fd', 'Convert a single or double to a signed 32-bit integer in an FP register, always rounding toward zero. NaN and out-of-range values are invalid and saturate.'],
	['fstod fdtos', '%fs2, %fd', 'Widen a single to a double exactly, or narrow a double to a single rounded by FSR.RD. NaNs are quieted and keep their payload.'],
	['fcmps fcmpd', '%fs1, %fs2', 'Compare singles or doubles and set FSR.fcc: 0 equal, 1 less, 2 greater, 3 unordered. Only a signaling NaN is invalid. The next instruction must not be an FBfcc.'],
	['fcmpes fcmped', '%fs1, %fs2', 'Compare and set FSR.fcc like FCMP, but any NaN operand signals invalid. The next instruction must not be an FBfcc.'],
	['faddq fsubq fmulq fdivq fsqrtq fdmulq fitoq fstoq fdtoq fqtoi fqtos fqtod fcmpq fcmpeq', 'quad operands', 'Quad-precision FPop. It encodes, but this FPU does not implement quad precision, so it faults as fp_exception with ftt = unimplemented_FPop.'],
	['ldf', '[%rs1 + %rs2|simm13], %fd', 'Load a word into an FP register; LD with an %f destination is the same instruction. The address must be word aligned.'],
	['lddf', '[%rs1 + %rs2|simm13], %fd', 'Load a doubleword into an even/odd FP pair, high word into the even register; LDD with an %f destination is the same. The address must be eight-byte aligned.'],
	['ldfsr', '[%rs1 + %rs2|simm13], %fsr', 'Load FSR.RD, TEM, NS, fcc, aexc and cexc from a word; ver, ftt and qne are unchanged. LD [...],%fsr is the same instruction.'],
	['stf', '%fs, [%rs1 + %rs2|simm13]', 'Store an FP register as a word; ST with an %f source is the same. The address must be word aligned.'],
	['stdf', '%fs, [%rs1 + %rs2|simm13]', 'Store an even/odd FP pair as a doubleword, even register first; STD with an %f source is the same. The address must be eight-byte aligned.'],
	['stfsr', '%fsr, [%rs1 + %rs2|simm13]', 'Store FSR as a word. ST %fsr,[...] is the same instruction.'],
	['stdfq', '%fq, [%rs1 + %rs2|simm13]', 'Store the front of the deferred floating-point trap queue. This FPU completes FPops precisely, so the queue is always empty and STDFQ faults with ftt = sequence_error.'],
]
for (const [names, syntax, description] of fpHelp) for (const name of names.split(' ')) instructionHelp[name] = { syntax: `${name.toUpperCase()} ${syntax}`, description }
const fconditions = ['never', 'not equal (L, G or U)', 'less or greater (L or G)', 'unordered or less (U or L)', 'less (L)', 'unordered or greater (U or G)', 'greater (G)', 'unordered (U)', 'always', 'equal (E)', 'unordered or equal (U or E)', 'greater or equal (G or E)', 'unordered, greater or equal (U, G or E)', 'less or equal (L or E)', 'unordered, less or equal (U, L or E)', 'ordered (E, L or G)']
for (let i = 0; i < fbranches.length; i++) {
	const name = fbranches[i]
	instructionHelp[name] = { syntax: `${name.toUpperCase()} target`, description: `Branch when FSR.fcc is ${fconditions[i]}. Execute the delay instruction before selecting the target or fall-through. It must not directly follow an FCMP; THRAX faults if it does.` }
	instructionHelp[`${name},a`] = { syntax: `${name.toUpperCase()},A target`, description: `Branch when FSR.fcc is ${fconditions[i]}. Annul the delay instruction if not taken; FBA,A annuls it even when taken. It must not directly follow an FCMP.` }
}
for (const [alias, base] of Object.entries({ fbz: 'fbe', fbnz: 'fbne' })) for (const suffix of ['', ',a']) instructionHelp[alias + suffix] = { ...instructionHelp[base + suffix], syntax: `${(alias + suffix).toUpperCase()} target` }

// SPARC Architecture Manual V8 PDF pages: Appendix B definitions, and Table A-1 for synthetic instructions.
const manualPages = new Map(Object.entries({
	83: 'set jmp ret retl cmp tst not neg', 84: 'mov clr inc dec inccc deccc btst bset bclr btog',
	88: 'ld ldub lduh ldsb ldsh ldd', 90: 'ldf lddf ldfsr', 93: 'st stb sth std', 95: 'stf stdf stfsr stdfq',
	99: 'ldstub', 100: 'swap', 102: 'sethi', 103: 'nop', 104: 'and andn or orn xor xnor andcc orcc xorcc andncc orncc xnorcc',
	105: 'sll srl sra', 106: 'add addx addcc addxcc', 108: 'sub subx subcc subxcc', 111: 'umul smul umulcc smulcc',
	113: 'udiv sdiv udivcc sdivcc', 115: 'save restore',
	117: 'bn be ble bl bleu bcs bneg bvs ba bne bg bge bgu bcc bpos bvc bz bnz blu bgeu',
	119: 'fbn fbne fblg fbul fbl fbug fbg fbu fba fbe fbue fbge fbuge fble fbule fbo fbz fbnz',
	123: 'call', 124: 'jmpl', 127: 'tn te tle tl tleu tcs tneg tvs ta tne tg tge tgu tcc tpos tvc', 129: 'rd', 131: 'wr',
	134: 'stbar', 136: 'flush', 139: 'fitos fitod fitoq', 140: 'fstoi fdtoi fqtoi', 141: 'fstod fdtos fstoq fdtoq fqtos fqtod',
	142: 'fmovs fnegs fabss', 143: 'fsqrts fsqrtd fsqrtq', 144: 'fadds fsubs faddd fsubd faddq fsubq',
	145: 'fmuls fdivs fmuld fdivd fsmuld fmulq fdivq fdmulq', 146: 'fcmps fcmpd fcmpes fcmped fcmpq fcmpeq',
}).flatMap(([page, names]) => names.split(' ').map((name) => [name, Number(page)] as const)))
/** Annulling branches share their branch's page. */
const pdfInstructionLink = instructionLinks(reference, (name) => manualPages.get(name.replace(/,a$/, '')))

export const instructionLink = preferInstructionLinks(name => htmlInstructionLink(name.replace(/,a$/i, '')), pdfInstructionLink)
