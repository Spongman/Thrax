import { htmlReference } from './htmlReferences'
import { cpuHistorySchema, type CpuConfiguration } from '../../core/configuredCpu'
import { createConfiguredFamily } from '../../core/configuredFamily'
import { defineSettings, type TargetSettings } from '../../core/settings'
import { variantCatalog, variantSetting } from '../../core/variants'
import { assembleVax, DATA_BASE, encodeInstruction, MEMORY_BYTES, TEXT_BASE } from './assembler'
import { examples, fixedPointExamples } from './examples'
import { instructionHelp } from './instructionHelp'
import { decode, instructions, MICROVAX2, MICROVAX2_NO_FPU, PSL, PSL_WRITABLE, reset, STATE_WORDS, VAX780, type Model } from './isa'
import { instructionLink } from './manual'
import { manifest } from './manifest'

const general = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11']
// R0-R11 also read as F_floating, and as D_floating with Rn holding the sign word and Rn+1 the rest.
const registers: CpuConfiguration['registers'] = [
	...general.map((name, index) => ({ id: name.toLowerCase(), name, bank: 'cpu', group: 'General', bits: 32, editable: true, floatEncoding: 'dec', ...(index < 11 ? { pairsWith: `r${index + 1}`, highWordFirst: true } : {}) })),
	{ id: 'ap', name: 'AP', aliases: ['R12'], bank: 'cpu', group: 'Frame', bits: 32, editable: true },
	{ id: 'fp', name: 'FP', aliases: ['R13'], bank: 'cpu', group: 'Frame', bits: 32, editable: true },
	{ id: 'sp', name: 'SP', aliases: ['R14'], bank: 'cpu', group: 'Frame', bits: 32, editable: true, role: 'stackPointer' },
	{ id: 'psl', name: 'PSL', bank: 'cpu', group: 'Frame', bits: 32, editable: true, role: 'flags' },
]

const NAMES = ['DEC VAX-11/780', 'DEC MicroVAX II', 'DEC MicroVAX II without FPU']
function configuration(model: Model): CpuConfiguration {
	return {
		id: manifest.id, name: NAMES[model], language: `thrax-vax${['780', 'uvax2', 'uvax2-nofpu'][model]}`, reference: htmlReference, instructionLink,
		registers, pcBits: 32, memoryBytes: MEMORY_BYTES, textBase: TEXT_BASE, dataBase: DATA_BASE,
		wordBytes: 4, instructionAlignment: 1, littleEndian: true, stateWords: STATE_WORDS,
		historySchema: cpuHistorySchema({ registers: PSL + 1, wide: false, instructionBytes: 32 }),
		examples: model === MICROVAX2_NO_FPU ? fixedPointExamples : examples, instructions, instructionHelp, comments: [';'],
		tokenPattern: /[\w.$]+/g,
		writeRegister(c, index, value) { c.r[index] = index === PSL ? (Number(value) & PSL_WRITABLE | c.r[PSL] & ~PSL_WRITABLE) >>> 0 : Number(value) },
		reset: c => reset(c, model),
		instructionSize: (name, operands) => encodeInstruction(name, operands, TEXT_BASE, () => undefined).bytes.length,
		encode: (name, operands, context) => encodeInstruction(name, operands, context.address, text => context.value(text)).bytes,
		decode: (memory, address) => decode(memory, address, model),
		assemble: assembleVax,
	}
}

const models = variantCatalog('780', { '780': { label: 'VAX-11/780' }, uvax2: { label: 'MicroVAX II' } })
const microVax = (settings: TargetSettings) => settings.cpuModel === 'uvax2'
const settings = defineSettings({ defaults: { cpuModel: '780', fpu: 'fpu' }, fields: [
	variantSetting('cpuModel', models),
	{ key: 'fpu', group: 'CPU', role: 'variant', label: 'Floating point', rebuild: true, isValid: (value: unknown) => value === 'fpu' || value === 'none',
		control: { kind: 'choice', options: [
			{ value: 'fpu', label: 'Built in: F, D, G and H', when: settings => !microVax(settings) },
			{ value: 'fpu', label: '78132 FPU: F, D and G', when: microVax },
			{ value: 'none', label: 'None: F, D and G trap', when: microVax },
		] } },
], details: group => group === 'CPU' ? ['Kernel mode with physical addressing: no memory management, interrupts or exception vectors, so a fault or trap stops the program.'] : [] })

export default createConfiguredFamily({ id: manifest.id, name: manifest.name, defaultModel: '780', settings,
	// A VAX-11/780 always has its floating point; only the MicroVAX II can lack the 78132.
	selectModel: settings => microVax(settings) ? settings.fpu === 'none' ? 'uvax2-nofpu' : 'uvax2' : '780',
	models: {
		'780': { label: 'VAX-11/780', configuration: configuration(VAX780) },
		uvax2: { label: 'MicroVAX II', configuration: configuration(MICROVAX2) },
		'uvax2-nofpu': { label: 'MicroVAX II without FPU', configuration: configuration(MICROVAX2_NO_FPU) },
	},
})
