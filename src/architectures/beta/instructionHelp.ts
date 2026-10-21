import { formatInstructionHelp, type InstructionHelp, type InstructionTable } from '../../core/instructionHelp'

const ALU: InstructionTable = {
	add: ['RA,RB,RC', 'Add RA and RB into RC, keeping the low 32 bits.'],
	sub: ['RA,RB,RC', 'Subtract RB from RA into RC, keeping the low 32 bits.'],
	mul: ['RA,RB,RC', 'Multiply RA and RB into RC, keeping the low 32 bits.'],
	div: ['RA,RB,RC', 'Divide RA by RB as signed integers, rounding toward zero.'],
	cmpeq: ['RA,RB,RC', 'Set RC to 1 if RA equals RB, otherwise 0.'],
	cmplt: ['RA,RB,RC', 'Set RC to 1 if RA is less than RB as signed integers, otherwise 0.'],
	cmple: ['RA,RB,RC', 'Set RC to 1 if RA is less than or equal to RB as signed integers, otherwise 0.'],
	and: ['RA,RB,RC', 'Bitwise AND of RA and RB into RC.'],
	or: ['RA,RB,RC', 'Bitwise OR of RA and RB into RC.'],
	xor: ['RA,RB,RC', 'Bitwise exclusive OR of RA and RB into RC.'],
	xnor: ['RA,RB,RC', 'Complement the exclusive OR of RA and RB into RC.'],
	shl: ['RA,RB,RC', 'Shift RA left by the low 5 bits of RB, filling with zeros.'],
	shr: ['RA,RB,RC', 'Shift RA right by the low 5 bits of RB, filling with zeros.'],
	sra: ['RA,RB,RC', 'Shift RA right by the low 5 bits of RB, preserving its sign.'],
}
const DOCS: InstructionTable = {
	...ALU,
	...Object.fromEntries(Object.entries(ALU).map(([name, [args, summary]]) => [name + 'c', [args.replace('RB', 'C'), summary.replace(/RB/g, 'a sign-extended 16-bit constant C')]])),
	ld: ['RA,CC,RC', 'Load the word at RA plus sign-extended CC into RC. The two-operand form uses R31 as base.'],
	st: ['RC,CC,RA', 'Store RC at RA plus sign-extended CC. The two-operand form uses R31 as base.'],
	ldr: ['LABEL,RC', 'Load the word at a PC-relative label into RC.'],
	jmp: ['RA,RC', 'Jump through RA, saving PC + 4 in RC. The one-operand form discards the link in R31.'],
	beq: ['RA,LABEL,RC', 'Branch if RA is zero; write PC + 4 to RC whether or not the branch is taken.'],
	bne: ['RA,LABEL,RC', 'Branch if RA is nonzero; write PC + 4 to RC whether or not the branch is taken.'],
	bf: ['RA,LABEL', 'Branch if RA is false (zero); alias of BEQ.'],
	bt: ['RA,LABEL', 'Branch if RA is true (nonzero); alias of BNE.'],
	br: ['LABEL', 'Branch unconditionally, optionally saving the return address in RC.'],
	move: ['RA,RC', 'Copy RA into RC.'],
	cmove: ['CC,RC', 'Load a sign-extended 16-bit constant into RC.'],
	push: ['RA', 'Push RA onto the upward-growing stack and advance SP by four bytes.'],
	pop: ['RC', 'Pop a word into RC and reduce SP by four bytes.'],
	allocate: ['N', 'Reserve N words on the upward-growing stack.'],
	deallocate: ['N', 'Release N words from the stack.'],
	call: ['LABEL', 'Call LABEL, saving the return address in LP. A second argument releases N stack words after return.'],
	rtn: ['', 'Return through LP.'],
	xrtn: ['', 'Return from an exception through XP, restoring the PC privilege bit.'],
	getframe: ['OFFSET,REG', 'Load REG from the frame at BP + OFFSET.'],
	putframe: ['REG,OFFSET', 'Store REG into the frame at BP + OFFSET.'],
	halt: ['', 'Stop execution using the BSim privileged HALT service.'],
	rdchar: ['', 'Read a console character into R0, waiting for input if necessary.'],
	wrchar: ['', 'Write the low byte of R0 to the console.'],
	cycle: ['', 'Read the simulated cycle count into R0.'],
	time: ['', 'Read the simulator time service into R0.'],
	click: ['', 'Read the pending mouse-click service into R0.'],
	random: ['', 'Read the next pseudorandom value into R0.'],
	seed: ['', 'Seed the pseudorandom generator from R0.'],
	server: ['', 'Invoke the BSim server service; availability depends on the machine environment.'],
	svc: ['CODE', 'Invoke the supervisor-call exception with the supplied service code.'],
}

export function betaInstructionHelp(name: string, definitions: readonly string[] = []): InstructionHelp | null {
	const lower = name.toLowerCase()
	const entry = Object.prototype.hasOwnProperty.call(DOCS, lower) ? DOCS[lower] : undefined
	if (!entry && !definitions.length) return null
	const forms = definitions.length ? definitions.map((definition) => /^\.macro\s+(\S+?\([^)]*\))/.exec(definition)?.[1]).filter((form): form is string => !!form)
		: [`${name.toUpperCase()}(${entry![0]})`]
	return formatInstructionHelp(name, {
		summary: entry?.[1] ?? 'Assembler macro; its expansion is shown below.',
		kind: 'UASM macro', forms,
		details: definitions.map((definition) => `\`${definition}\``),
		reference: entry ? 'https://ocw.mit.edu/courses/6-004-computation-structures-spring-2009/resources/mit6_004s09_lab_beta_summary/' : undefined,
	})
}
