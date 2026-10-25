import { htmlReference } from './htmlReferences'
import { cpuHistorySchema, createConfiguredArchitecture, type CpuConfiguration } from '../../core/configuredCpu'
import { RegisterFormat } from '../contracts'
import { afterInstruction, advance, decode, encode, getRegister, instructionSize, NPC, PSR, registerNames, setRegister, STATE_WORDS, WIM, Y, instructions } from './isa'
import { F0, FSR, FSR_WRITABLE } from './fpu'
import { manifest } from './manifest'
import { examples } from './examples'
import { instructionHelp, instructionLink } from './instructionHelp'

export const configuration: CpuConfiguration = {
	...manifest, language: 'thrax-sparc', reference: htmlReference,
	registers: [
		...registerNames.map((name, index) => ({ id: name, name: `%${name}`, aliases: [`%${name}`, `r${index}`, `%r${index}`, ...(index === 14 ? ['sp', '%sp'] : index === 30 ? ['fp', '%fp'] : [])], bank: ['globals', 'outs', 'locals', 'ins'][index >>> 3], bits: 32, editable: index !== 0, ...(index === 14 ? { role: 'stackPointer' as const } : index === 15 ? { role: 'link' as const } : {}) })),
		{ id: 'npc', name: 'nPC', aliases: ['%npc'], bank: 'control', bits: 32, editable: true },
		{ id: 'psr', name: 'PSR', aliases: ['%psr'], bank: 'control', bits: 32, editable: true, role: 'flags' },
		{ id: 'y', name: 'Y', aliases: ['%y'], bank: 'control', bits: 32, editable: true },
		{ id: 'wim', name: 'WIM', aliases: ['%wim'], bank: 'control', bits: 8, editable: true },
		// Even registers start doubles and hold their high word.
		...Array.from({ length: 32 }, (_, index) => ({ id: `f${index}`, name: `%f${index}`, aliases: [`%f${index}`], bank: 'FPU', group: 'Floating Point', bits: 32, editable: true, format: RegisterFormat.FLOAT, ...(index % 2 ? {} : { pairsWith: `f${index + 1}`, highWordFirst: true }) })),
		{ id: 'fsr', name: 'FSR', aliases: ['%fsr'], bank: 'FPU', group: 'Status', bits: 32, editable: true },
	],
	pcBits: 32, memoryBytes: 0x100000, textBase: 0x1000, dataBase: 0x10000,
	wordBytes: 4, instructionAlignment: 4, fixedInstructionBytes: 4, littleEndian: false,
	directiveWidths: { '.word': 4, '.half': 2, '.hword': 2 },
	stateWords: STATE_WORDS, delayedBranching: true,
	historySchema: cpuHistorySchema({ registers: FSR + 1, wide: false, instructionBytes: 4 }),
	examples, instructions, instructionHelp, instructionLink, comments: ['!', '//'],
	readRegister: (cpu, index) => index < 32 ? getRegister(cpu, index) : cpu.r[index],
	writeRegister(cpu, index, value) {
		const n = Number(value)
		if (index < 32) setRegister(cpu, index, n)
		else {
			if (index === PSR && (n & 31) >= 8) throw new Error('This SPARC implements eight register windows')
			if (index === NPC && (n & 3)) throw new Error('nPC must be word aligned')
			cpu.r[index] = index === PSR ? n & 0xf00007 : index === FSR ? n & FSR_WRITABLE : n
		}
	},
	reset(cpu) { cpu.r[NPC] = cpu.pc + 4; cpu.r[PSR] = cpu.r[Y] = cpu.r[WIM] = cpu.r[FSR] = 0; cpu.r.fill(0, F0, F0 + 32); setRegister(cpu, 14, cpu.memory.length - 96) },
	setProgramCounter(cpu, address) { cpu.pc = address; cpu.r[NPC] = address + 4; for (let index = 136; index < STATE_WORDS; index++) cpu.writeState(index, 0) },
	advance, afterInstruction, fallThrough: cpu => cpu.pc + 8,
	encode, decode, instructionSize,
}
export default createConfiguredArchitecture(configuration)
