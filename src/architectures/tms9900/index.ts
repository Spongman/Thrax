import { htmlReference } from './htmlReferences'
import { instructionHelp, instructionLink } from './instructionHelp'
import type { CpuConfiguration } from '../../core/configuredCpu'
import { cpuHistorySchema, createConfiguredArchitecture } from '../../core/configuredCpu'
import { manifest } from './manifest'
import { examples } from './examples'
import { decode, encode, instructionSize, setRegister, ST, WP, instructions } from './isa'

export const configuration: CpuConfiguration = {
	...manifest,
	language: 'thrax-tms9900',
	reference: htmlReference,
	registers: [
		...Array.from({ length: 16 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, bits: 16, bank: 'workspace', editable: true, ...(i === 10 ? { role: 'stackPointer' as const } : i === 11 ? { role: 'link' as const } : {}) })),
		{ id: 'wp', name: 'WP', bits: 16, bank: 'special', editable: true },
		{ id: 'st', name: 'ST', bits: 16, bank: 'special', editable: true, role: 'flags' },
	],
	pcBits: 16, memoryBytes: 0x10000, textBase: 0x1000, dataBase: 0x4000,
	wordBytes: 2, instructionAlignment: 2, littleEndian: false,
	historySchema: cpuHistorySchema({ registers: 18, wide: false, instructionBytes: 6 }), instructionHelp, instructionLink,
	examples, instructions, comments: [';', '//'],
	readRegister(cpu, index) {
		if (index >= 16) return cpu.r[index]
		const address = cpu.r[WP] + index * 2 & 65535
		return cpu.memory[address] << 8 | cpu.memory[address + 1]
	},
	writeRegister(cpu, index, value) { setRegister(cpu, index, Number(value)) },
	reset(cpu) { cpu.r[WP] = 0x8000; cpu.r[ST] = 0; setRegister(cpu, 10, 0xff00) },
	advance(cpu, size) { cpu.pc = cpu.pc + size & 65535 },
	fallThrough(cpu, size) { return cpu.pc + size & 65535 },
	fetchAddress(_cpu, address, offset) { return address + offset & 65535 },
	encode, decode, instructionSize,
}
export default createConfiguredArchitecture(configuration)
