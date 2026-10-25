import { instructionHelp } from './instructionHelp'
import { instructionHelpGroups } from '../../core/instructionHelp'

export function variantHelp(model: 'm6809' | 'hc11') {
	const help = { ...instructionHelp, ...instructionHelpGroups([
		['ldd', '#data16 | <direct | indexed | address', 'Load double accumulator D (A:B) from an immediate or big-endian memory word; update N/Z and clear V.'],
		['std', '<direct | indexed | address', 'Store A:B as a big-endian word; update N/Z and clear V.'],
		['addd subd', '#data16 | <direct | indexed | address', 'Add or subtract a 16-bit operand from D (A:B), updating N/Z/V/C. H is preserved.'],
		['ldx ldy ldu lds', '#data16 | <direct | indexed | address', 'Load the named 16-bit register; memory operands are big-endian. Update N/Z and clear V.'],
		['stx sty stu sts', '<direct | indexed | address', 'Store the named 16-bit register in big-endian order; update N/Z and clear V.'],
		['cpx cpy cpd cmpx cmpy cmpd cmpu cmps', '#data16 | <direct | indexed | address', 'Compare the full 16-bit register with the operand using subtraction; update N/Z/V/C, with C reporting borrow. The register is unchanged.'],
		['brn', 'target', 'Never take the signed eight-bit relative branch; condition codes are unchanged.'],
		['mul', '', model === 'm6809' ? 'Multiply unsigned A by B into D (A:B). Update Z; C receives product bit 7. Other flags are preserved.' : 'Multiply unsigned A by B into D (A:B). C receives product bit 7; all other flags are preserved.'],
		['abx aby', '', 'Add unsigned B to X or Y without changing condition codes.'],
	]) }
	for (const [alias, original] of Object.entries({ lda: 'ldaa', ldb: 'ldab', sta: 'staa', stb: 'stab', ora: 'oraa', orb: 'orab' })) help[alias] = { ...help[original], syntax: help[original].syntax.replace(/^\S+/, alias.toUpperCase()) }
	if (model === 'hc11') Object.assign(help, instructionHelpGroups([
		['idiv', '', 'Divide unsigned D by X. Write quotient to X and remainder to D; update Z, clear V and set C on a zero divisor. Division by zero writes FFFF to X and preserves the indeterminate remainder in this simulator.'],
		['fdiv', '', 'Divide unsigned D times 65536 by X to produce a fractional quotient in X and remainder in D. Update Z/V/C; overflow or division by zero writes FFFF to X and preserves the indeterminate remainder.'],
		['asld lsld lsrd', '', 'Shift D left or logically right by one bit; update N/Z/V/C. LSLD aliases ASLD.'],
		['xgdx xgdy', '', 'Exchange D (A:B) with X or Y. Condition codes are unchanged.'],
		['iny dey', '', 'Increment or decrement Y. Only Z is affected.'],
		['tsy tys', '', 'TSY copies S+1 to Y; TYS copies Y-1 to S. Condition codes are unchanged.'],
		['pshx pshy pulx puly', '', 'Push or pull a big-endian X/Y word on the native descending, post-decrement stack. Condition codes are unchanged.'],
		['bset bclr', 'direct|offset,X|offset,Y, #mask8', 'Set or clear masked bits of a memory byte; update N/Z and clear V. Indexed offsets are unsigned bytes.'],
		['brset brclr', 'direct|offset,X|offset,Y, #mask8, target', 'Branch when all masked bits are set (BRSET) or all are clear (BRCLR). Use a signed eight-bit displacement; condition codes are unchanged.'],
		['tap tpa', '', 'Transfer A to CCR or CCR to A. TAP cannot set X once the X interrupt mask has been cleared.'],
		['rti', '', 'Pull CCR, B, A, X, Y and PC from the native interrupt frame. Native external interrupt delivery is not modeled.'],
		['stop', '', 'With CCR.S set, continue as a no-op. Otherwise STOP needs an external wakeup source and faults in this functional environment.'],
	]))
	else {
		Object.assign(help, instructionHelpGroups([
			['exg tfr', 'source, destination', 'Exchange or transfer equal-width native registers, including D, X, Y, U, S, PC, A, B, CC and DP. Mixed widths are rejected as undefined native forms. Condition codes change only when CC is a destination.'],
			['pshs puls pshu pulu', 'register[,register...]', 'Push or pull a register mask on S or U. Push uses native descending pre-decrement order; pull reverses it. D abbreviates A,B. Pulling PC is tracked as a return.'],
			['leax leay leas leau', 'indexed', 'Compute a native indexed effective address into the named register. LEAX/LEAY update only Z; LEAS/LEAU preserve condition codes.'],
			['sex', '', 'Sign-extend B into D (A:B), updating N/Z and preserving the other condition bits.'],
			['orcc andcc', '#mask8', 'OR or AND an immediate mask into all eight native CC bits, including E and F.'],
			['sync cwai', '[#mask8 for CWAI]', 'Wait for an external interrupt. This environment does not deliver external interrupts, so execution faults atomically.'],
			['swi2 swi3', '', 'Native software interrupt variants. Their supervisor vector handling is outside the teaching monitor and faults atomically. SWI alone invokes the THRAX monitor.'],
			['rti', '', 'Pull CC then PC from the S stack; when restored CC.E is set, also restore A, B, DP, X, Y and U in native order.'],
			['rts', '', 'Pull the 16-bit return address from the native pre-decrement S stack and return through the common call controller.'],
			['jsr', '<direct | indexed | address', 'Push the native return address and call a direct-page, indexed or extended destination. DP supplies the high direct-address byte.'],
		]))
		for (const name of ['bra', 'brn', 'bhi', 'bls', 'bcc', 'bcs', 'bne', 'beq', 'bvc', 'bvs', 'bpl', 'bmi', 'bge', 'blt', 'bgt', 'ble', 'bhs', 'blo', 'bsr']) help[`l${name}`] = { ...help[name], syntax: `L${name.toUpperCase()} target`, description: help[name].description.replace(/(?:signed )?8-bit/g, 'signed 16-bit').replace('eight-bit', '16-bit') }
		for (const name of ['lsr', 'asr', 'ror', 'tst']) for (const suffix of ['', 'a', 'b']) help[name + suffix] = { ...help[name + suffix], description: name === 'tst' ? 'Test a byte without changing it; update N/Z, clear V and preserve C.' : 'Shift/rotate right by one bit, with native sign or carry input; update N/Z/C and preserve V.' }
	}
	return help
}
