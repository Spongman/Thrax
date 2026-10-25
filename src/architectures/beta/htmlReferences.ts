import { instructionLinks } from '../../core/instructionHelp'

export const htmlReference = 'https://computationstructures.org/notes/isas/notes.html'
export const htmlInstructionLink = instructionLinks(htmlReference, Object.fromEntries([
	['add sub mul div cmpeq cmplt cmple and or xor xnor shl shr sra', '#TARGET_14.8.3'],
	['addc subc mulc divc cmpeqc cmpltc cmplec andc orc xorc xnorc shlc shrc srac', '#TARGET_14.8.4'],
	['beq bne jmp br', '#TARGET_14.8.5'],
	['ld st ldr', '#TARGET_14.8.6'],
].flatMap(([names, target]) => names.split(' ').map(name => [name, target]))))
