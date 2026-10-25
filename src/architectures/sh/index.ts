import { createConfiguredFamily } from '../../core/configuredFamily'
import { cpuHistorySchema, type CpuConfiguration } from '../../core/configuredCpu'
import { manifest } from './manifest'
import { advance, afterInstruction, decode, encode, GBR, instructionSize, instructionsFor, MACH, MACL, PR, reference, SR, VBR, type Model } from './isa'
import { instructionHelp, instructionLink } from './instructionHelp'
import { examples } from './examples'

export function configuration(model: Model): CpuConfiguration {
	return {
		...manifest, name: model === 'sh1' ? 'SuperH SH-1' : 'SuperH SH-2', language: `thrax-${model}`, reference,
		registers: [
			...Array.from({ length: 16 }, (_, index) => ({ id: `r${index}`, name: `R${index}`, bank: 'cpu', bits: 32, editable: true, ...(index === 15 ? { role: 'stackPointer' as const, aliases: ['sp'] } : {}) })),
			{ id: 'sr', name: 'SR', bank: 'control', bits: 32, editable: true, role: 'flags' },
			{ id: 'gbr', name: 'GBR', bank: 'control', bits: 32, editable: true },
			{ id: 'vbr', name: 'VBR', bank: 'control', bits: 32, editable: true },
			{ id: 'mach', name: 'MACH', bank: 'control', bits: 32, editable: true },
			{ id: 'macl', name: 'MACL', bank: 'control', bits: 32, editable: true },
			{ id: 'pr', name: 'PR', bank: 'control', bits: 32, editable: true, role: 'link' },
		],
		pcBits: 32, memoryBytes: 0x100000, textBase: 0x1000, dataBase: 0x10000, wordBytes: 4, instructionAlignment: 2, fixedInstructionBytes: 2,
		directiveWidths: { '.word': 2, '.long': 4 }, littleEndian: false, stateWords: 4, delayedBranching: true,
		historySchema: cpuHistorySchema({ registers: 22, wide: false, instructionBytes: 2 }),
		instructions: instructionsFor(model), instructionHelp, instructionLink, instructionSize, examples, comments: [';', '//'],
		encode: (name, operands, context) => encode(name, operands, context, model), decode: (memory, address) => decode(memory, address, model),
		advance, afterInstruction, fallThrough: c => c.pc + 4 >>> 0,
		setProgramCounter(c, address) { c.pc = address; for (let i = 0; i < 4; i++) c.writeState(i, 0) },
		writeRegister(c, index, value) { const n = Number(value); c.r[index] = index === SR ? n & 0x3f3 : model === 'sh1' && index === MACH ? n << 22 >> 22 : n },
		reset(c) { c.r[15] = c.memory.length - 16; for (const i of [SR, GBR, VBR, MACH, MACL, PR]) c.r[i] = 0 },
	}
}
export default createConfiguredFamily({ id: manifest.id, name: manifest.name, defaultModel: 'sh2', models: {
	sh2: { label: 'SH-2', configuration: configuration('sh2') },
	sh1: { label: 'SH-1', configuration: configuration('sh1') },
} })
