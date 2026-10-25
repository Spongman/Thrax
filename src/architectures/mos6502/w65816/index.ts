import { instructionHelp, instructionLink, reference } from './instructionHelp'
import { createConfiguredArchitecture } from '../../../core/configuredCpu'
import { examples } from './examples'
import { historySchema } from './history'
import { decode, encode, enforceWidths, instructionSize, instructions } from './isa'
import { registers } from './metadata'

export default createConfiguredArchitecture({
	id: 'w65816', name: 'WDC 65C816', language: 'thrax-w65816',
	reference,
	registers,
	pcBits: 24, memoryBytes: 0x1000000, textBase: 0x1000, dataBase: 0x8000,
	wordBytes: 2, instructionAlignment: 1, littleEndian: true,
	historySchema, instructionHelp, instructionLink, examples, instructions, comments: [';'],
	reset(cpu) { cpu.r[3] = 0x1ff; cpu.r[4] = 0x34; cpu.r[8] = 1; cpu.r[7] = cpu.pc >>> 16 },
	fetchAddress(_cpu, address, offset) { return (address & 0xff0000) | ((address + offset) & 65535) },
	decodeKey(cpu) { return (cpu.r[4] & 0x30) | (cpu.r[8] << 6) },
	advance(cpu, size) { cpu.pc = (cpu.pc & 0xff0000) | ((cpu.pc + size) & 65535); cpu.r[7] = cpu.pc >>> 16 },
	fallThrough(cpu, size) { return (cpu.pc & 0xff0000) | ((cpu.pc + size) & 65535) },
	setProgramCounter(cpu, address) { cpu.pc = address & 0xffffff; cpu.r[7] = cpu.pc >>> 16 },
	writeRegister(cpu, index, value) { const bits = index === 8 ? 1 : index === 4 || index === 6 || index === 7 ? 8 : 16; cpu.r[index] = Number(value) & ((1 << bits) - 1); enforceWidths(cpu); if (index === 7) cpu.pc = (cpu.r[7] << 16) | (cpu.pc & 65535) },
	instructionSize, encode, decode,
})
