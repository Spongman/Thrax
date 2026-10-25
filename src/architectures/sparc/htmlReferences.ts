import { instructionLinks } from '../../core/instructionHelp'

export const htmlReference = 'https://docs.oracle.com/cd/E19120-01/open.solaris/816-1681/instructionset-18901/index.html'
/** Sun's v8 instruction tables, including synthetic and FP operations. */
export const htmlInstructionLink = instructionLinks(htmlReference, Object.fromEntries([
	['fbnz', '#instructionset-14888'],
	['fbz', '#instructionset-14888'],
	['bgeu', '#instructionset-14888'],
	['blu', '#instructionset-14888'],
	['bnz', '#instructionset-14888'],
	['bz', '#instructionset-14888'],
	['add addcc addx addxcc and andcc andn ba bcc bcs be bg bge bgu bl ble bleu bn bne bneg bpos bvc bvs fba fbe fbg fbge fbl fble fblg fbn fbne fbo fbu fbue fbug fbuge fbul fbule flush jmpl ld ldd ldsb ldsh ldstub ldub lduh nop or orcc orn orncc rd sdiv sdivcc sethi sll smul smulcc sra srl st stb std sth sub subcc subx subxcc swap ta te tg tge tgu tl tle tleu tn tne tneg tpos tvc tvs udiv udivcc umul umulcc wr xnor xnorcc xor xorcc', '#instructionset-14888'],
	['bclr bset btog btst call clr cmp dec deccc inc inccc jmp mov neg not restore save set tst', '#instructionset-28164'],
	['fabss faddd faddq fadds fcmpd fcmped fcmpeq fcmpes fcmpq fcmps fdivd fdivq fdivs fdtoi fdtoq fdtos fitod fitoq fitos fmovs fmuld fmulq fmuls fnegs fqtod fqtoi fqtos fsmuld fsqrtd fsqrtq fsqrts fstod fstoi fstoq fsubd fsubq fsubs', '#instructionset-20389'],
].flatMap(([names, target]) => names.split(' ').map(name => [name, target]))))
