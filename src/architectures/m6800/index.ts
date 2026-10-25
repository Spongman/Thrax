import { htmlReference as m6800HtmlReference } from './m6800HtmlReferences'
import { htmlReference as m6809HtmlReference } from './m6809HtmlReferences'
import { htmlReference as hc11HtmlReference } from './hc11HtmlReferences'
import { instructionHelp } from './instructionHelp'
import { cpuHistorySchema, type CpuConfiguration } from '../../core/configuredCpu'
import { createConfiguredFamily } from '../../core/configuredFamily'
import * as m6809 from './m6809'
import * as hc11 from './hc11'
import { getD, setD, Y, U, DP } from './operations'
import { variantHelp } from './variantHelp'
import { hc11InstructionLink, m6800InstructionLink, m6809InstructionLink } from './instructionLinks'
import { hc11Examples, m6809Examples } from './variantExamples'
import { EXAMPLES } from './examples'
import { historySchema } from './history'
import { A, B, X, SP, CC, decode, encode, instructionSize, instructions } from './isa'

export const configuration: CpuConfiguration = {
	id: 'm6800', name: 'Motorola 6800', language: 'm6800', reference: m6800HtmlReference,
	registers: [
		{ id: 'a', name: 'A', bank: 'cpu', bits: 8, editable: true },
		{ id: 'b', name: 'B', bank: 'cpu', bits: 8, editable: true },
		{ id: 'x', name: 'X', bank: 'cpu', bits: 16, editable: true },
		{ id: 'sp', name: 'SP', bank: 'cpu', bits: 16, editable: true, role: 'stackPointer' },
		{ id: 'cc', name: 'CC', bank: 'cpu', bits: 8, editable: true, role: 'flags' },
	],
	pcBits: 16, memoryBytes: 65536, textBase: 0x1000, dataBase: 0x4000, wordBytes: 2, instructionAlignment: 1, littleEndian: false,
	historySchema, instructionHelp, instructionLink: m6800InstructionLink, examples: EXAMPLES, instructions, comments: [';'], instructionSize, encode, decode: (memory, address) => decode(memory, address),
	advance(c, size) { c.pc = c.pc + size & 65535 },
	fallThrough(c, size) { return c.pc + size & 65535 },
	fetchAddress(_c, address, offset) { return address + offset & 65535 },
	reset(c) { c.r[A] = 0; c.r[B] = 0; c.r[X] = 0; c.r[SP] = 0xefff; c.r[CC] = 0xd0 },
}

function extended(cpu: 'm6809' | 'hc11'): CpuConfiguration {
	const isa = cpu === 'm6809' ? m6809 : hc11
	const registers = [...configuration.registers.map(r => r.id === 'sp' && cpu === 'm6809' ? { ...r, aliases: ['s'] } : r),
		{ id: 'y', name: 'Y', bank: 'cpu', bits: 16, editable: true },
		...(cpu === 'm6809' ? [{ id: 'u', name: 'U', bank: 'cpu', bits: 16, editable: true }, { id: 'dp', name: 'DP', bank: 'cpu', bits: 8, editable: true }] : []),
		{ id: 'd', name: 'D (A:B)', bank: 'cpu', bits: 16, editable: true },
	]
	const double = registers.length - 1
	return { ...configuration, name: cpu === 'm6809' ? 'Motorola 6809' : 'Motorola 68HC11', language: cpu, reference: cpu === 'm6809' ? m6809HtmlReference : hc11HtmlReference, registers,
		instructions: isa.instructions, instructionSize: isa.instructionSize, encode: isa.encode, decode: isa.decode,
		instructionHelp: variantHelp(cpu), instructionLink: cpu === 'm6809' ? m6809InstructionLink : hc11InstructionLink, examples: cpu === 'm6809' ? m6809Examples : hc11Examples,
		historySchema: cpuHistorySchema({ registers: registers.length, wide: false, instructionBytes: 5 }),
		readRegister: (c, index) => index === double ? getD(c) : c.r[index],
		writeRegister: (c, index, value) => { if (index === double) setD(c, Number(value)); else c.r[index] = Number(value) },
		reset(c) { c.r[SP] = 0xefff; c.r[CC] = cpu === 'm6809' ? 0x50 : 0xd0; c.r[Y] = 0; if (cpu === 'm6809') { c.r[U] = 0xdfff; c.r[DP] = 0 } },
	}
}
export const m6809Configuration = extended('m6809')
export const hc11Configuration = extended('hc11')
export default createConfiguredFamily({ id: 'm6800', name: 'Motorola 6800', defaultModel: 'm6800', models: {
	m6800: { label: '6800', configuration },
	m6809: { label: '6809', configuration: m6809Configuration },
	hc11: { label: '68HC11', configuration: hc11Configuration },
} })
