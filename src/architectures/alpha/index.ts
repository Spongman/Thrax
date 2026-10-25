import { htmlReference } from './htmlReferences'
import { instructionHelp, instructionLink } from './instructionHelp'
import type { CpuConfiguration } from '../../core/configuredCpu'
import { cpuHistorySchema, createConfiguredArchitecture } from '../../core/configuredCpu'
import { RegisterFormat, type ArchitectureDefinition, type RegisterDescriptor } from '../contracts'
import { manifest } from './manifest'
import { examples } from './examples'
import { decode, encode, instructions } from './isa'
import { FPCR, FPCR_MASK, FPCR_RESET } from './float'
import { describeFloatRegister } from './dataTips'

const aliases = ['v0', 't0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 's0', 's1', 's2', 's3', 's4', 's5', 'fp', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 't8', 't9', 't10', 't11', 'ra', 'pv', 'at', 'gp', 'sp', 'zero']
const registers: RegisterDescriptor[] = [
	...aliases.map((alias, i) => ({ id: `r${i}`, name: `$${i}`, aliases: [alias], bits: 64, bank: 'integer', editable: i !== 31, ...(i === 30 ? { role: 'stackPointer' as const } : i === 26 ? { role: 'link' as const } : {}) })),
	...Array.from({ length: 32 }, (_, i) => ({ id: `f${i}`, name: `$f${i}`, bits: 64, bank: 'float', group: 'Floating Point', editable: i !== 31, format: RegisterFormat.FLOAT })),
	{ id: 'fpcr', name: 'FPCR', bits: 64, bank: 'float', group: 'Control', editable: true },
]
export const configuration: CpuConfiguration = {
	...manifest,
	language: 'thrax-alpha',
	reference: htmlReference,
	registers,
	wideRegisters: true,
	pcBits: 64, memoryBytes: 0x100000, textBase: 0x1000, dataBase: 0x10000,
	wordBytes: 4, instructionAlignment: 4, littleEndian: true,
	historySchema: cpuHistorySchema({ registers: registers.length, wide: true, instructionBytes: 4 }), instructionHelp, instructionLink,
	examples, instructions, comments: ['#', ';'],
	reset(cpu) { cpu.w[30] = BigInt(cpu.memory.length - 32); cpu.w[FPCR] = FPCR_RESET },
	afterEdit(cpu) { cpu.w[FPCR] &= FPCR_MASK },
	instructionSize: () => 4,
	encode, decode,
}
const configured = createConfiguredArchitecture(configuration)
/** Float registers' data tips read their bits as IEEE values. */
const definition: ArchitectureDefinition = {
	...configured,
	createServices: () => {
		const services = configured.createServices(), describe = services.describeToken!
		services.describeToken = (text, column, state) => describeFloatRegister(describe(text, column, state), text, state)
		return services
	},
}
export default definition
