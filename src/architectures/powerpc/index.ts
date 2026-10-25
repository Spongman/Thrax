import { instructionHelp, instructionLink } from './instructionHelp'
import type { CpuConfiguration } from '../../core/configuredCpu'
import { cpuHistorySchema, createConfiguredArchitecture } from '../../core/configuredCpu'
import { manifest } from './manifest'
import { examples } from './examples'
import { decode, encode, instructions } from './isa'
import { RegisterFormat, type RegisterDescriptor } from '../contracts'
import { FPR, FPSCR, fpuWords, fpscrSummary, getF, setF } from './fpu'

const integerRegisters: RegisterDescriptor[] = [
	...Array.from({ length: 32 }, (_, i) => ({ id: `r${i}`, name: `r${i}`, bits: 32, bank: 'integer', editable: true, ...(i === 1 ? { role: 'stackPointer' as const } : {}) })),
	{ id: 'cr', name: 'CR', bits: 32, bank: 'special', editable: true, role: 'flags' },
	{ id: 'lr', name: 'LR', bits: 32, bank: 'special', editable: true, role: 'link' },
	{ id: 'ctr', name: 'CTR', bits: 32, bank: 'special', editable: true },
	{ id: 'xer', name: 'XER', bits: 32, bank: 'special', editable: true },
]
// The FPU is integrated in every supported (601/603/604/750-class) model, so it is always present.
const floatRegisters: RegisterDescriptor[] = [
	...Array.from({ length: 32 }, (_, i) => ({ id: `f${i}`, name: `f${i}`, bits: 64, bank: 'float', group: 'Floating-point registers', editable: true, format: RegisterFormat.FLOAT })),
	{ id: 'fpscr', name: 'FPSCR', bits: 32, bank: 'float', group: 'Status and control', editable: true },
]

export const configuration: CpuConfiguration = {
	...manifest,
	language: 'thrax-powerpc',
	reference: 'https://www.ibm.com/docs/en/aix/7.1.0?topic=reference-appendix-f-powerpc-instructions',
	registers: [...integerRegisters, ...Array.from({ length: fpuWords }, (_, i) => ({ id: `fpword${i}`, name: `FP word ${i}`, bits: 32, bank: 'float', editable: false }))],
	registerView: {
		registers: [...integerRegisters, ...floatRegisters],
		read: (words, index) => index < FPR ? words[index] : index < FPR + 32 ? getF({ r: words }, index - FPR) : words[FPSCR],
		write(cpu, index, value) {
			if (index < FPR) cpu.r[index] = Number(value)
			else if (index < FPR + 32) setF(cpu, index - FPR, BigInt(value))
			else cpu.r[FPSCR] = fpscrSummary(Number(value))
		},
	},
	pcBits: 32, memoryBytes: 0x100000, textBase: 0x1000, dataBase: 0x10000,
	wordBytes: 4, instructionAlignment: 4, littleEndian: false,
	historySchema: cpuHistorySchema({ registers: FPR + fpuWords, wide: false, instructionBytes: 4 }), instructionHelp, instructionLink,
	examples, instructions, comments: ['#', ';'],
	reset(cpu) { cpu.r[1] = cpu.memory.length - 16 },
	instructionSize: () => 4,
	encode, decode,
}
export default createConfiguredArchitecture(configuration)
