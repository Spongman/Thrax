import { cpuHistorySchema, type CpuConfiguration, type CpuContext } from '../../core/configuredCpu'
import { createConfiguredFamily } from '../../core/configuredFamily'
import { defineSettings, type TargetSettings } from '../../core/settings'
import { variantCatalog, variantSetting } from '../../core/variants'
import { RegisterFormat, type RegisterDescriptor, type RegisterValue } from '../contracts'
import { assemble, DIRECTIVES, encodeAbsolute } from './assembler'
import { EBCDIC_TO_UNICODE, unicodeToEbcdic } from './ebcdic'
import { editor } from './editor'
import { examples, floatExamples } from './examples'
import { instructionHelp } from './instructionHelp'
import { CC, DECIMAL, decodeInstruction, FLOAT, FPR, hasFeatures, IA, lengthOf, opcodes, PM, REGISTER_WORDS, S370, type Model } from './isa'
import { instructionLink, reference } from './manual'
import { manifest } from './manifest'

/** The monitor's save area and the EXIT stub that R14 returns to, just below the program origin. */
export const SAVE_AREA = 0x0f00, EXIT_STUB = 0x0ffe, ORIGIN = 0x1000

const general: RegisterDescriptor[] = Array.from({ length: 16 }, (_, i) => ({ id: `r${i}`, name: `R${i}`, bits: 32, bank: 'general', editable: true, ...(i === 14 ? { role: 'link' as const } : {}) }))
const psw: RegisterDescriptor[] = [
	{ id: 'psw', name: 'PSW', bits: 64, bank: 'general', group: 'PSW (BC mode)', editable: false },
	{ id: 'cc', name: 'CC', bits: 2, bank: 'general', group: 'PSW (BC mode)', editable: true, role: 'flags' },
	{ id: 'pm', name: 'PM', bits: 4, bank: 'general', group: 'PSW (BC mode)', editable: true },
]
const floating: RegisterDescriptor[] = [0, 2, 4, 6].map(n => ({ id: `f${n}`, name: `F${n}`, bits: 64, bank: 'floating', group: 'Floating-point registers', editable: true, format: RegisterFormat.FLOAT, floatEncoding: 'ibm' }))
const native: RegisterDescriptor[] = [
	...general,
	...Array.from({ length: 8 }, (_, i) => ({ id: `fword${i}`, name: `F${i & 6} ${i & 1 ? 'low' : 'high'}`, bits: 32, bank: 'floating', editable: false })),
	{ id: 'ccword', name: 'CC', bits: 32, bank: 'general', editable: false },
	{ id: 'pmword', name: 'PM', bits: 32, bank: 'general', editable: false },
	{ id: 'ia', name: 'Instruction address', bits: 32, bank: 'general', editable: false },
]

/** BC-mode PSW: system mask 0, key 0, AMWP = 0101 (EBCDIC, machine checks, running, problem state), then ILC, CC, mask, address. */
const pswOf = (words: Uint32Array) => 0x00050000n << 32n | BigInt((words[CC] << 28 | words[PM] << 24 | words[IA] & 0xffffff) >>> 0)

interface Variant { id: string, label: string, model: Model }

function configuration({ id, label, model }: Variant): CpuConfiguration {
	const float = hasFeatures(model, FLOAT)
	const view = [...general, ...(float ? floating : []), ...psw]
	const read = (words: Uint32Array, index: number): RegisterValue => {
		const register = view[index]
		if (index < 16) return words[index]
		if (register.id === 'psw') return pswOf(words)
		if (register.id === 'cc') return words[CC]
		if (register.id === 'pm') return words[PM]
		const n = FPR + Number(register.id.slice(1))
		return BigInt(words[n]) << 32n | BigInt(words[n + 1])
	}
	const write = (cpu: CpuContext, index: number, value: RegisterValue) => {
		const register = view[index]
		if (index < 16) cpu.r[index] = Number(value)
		else if (register.id === 'cc') cpu.r[CC] = Number(value) & 3
		else if (register.id === 'pm') cpu.r[PM] = Number(value) & 15
		else if (register.id.startsWith('f')) {
			const n = FPR + Number(register.id.slice(1)), bits = BigInt(value)
			cpu.r[n] = Number(bits >> 32n & 0xffffffffn); cpu.r[n + 1] = Number(bits & 0xffffffffn)
		}
	}
	const installed = [...opcodes.values()].filter(opcode => hasFeatures(model, opcode.requires)).map(opcode => opcode.name)
	return {
		...manifest, name: label, language: `thrax-s360-${id}`, reference, instructionLink,
		registers: native,
		registerView: { registers: view, read, write },
		pcBits: 24, memoryBytes: 0x100000, textBase: ORIGIN, dataBase: 0x10000,
		wordBytes: 4, instructionAlignment: 2, littleEndian: false,
		historySchema: cpuHistorySchema({ registers: REGISTER_WORDS, wide: false, instructionBytes: 6 }),
		examples: float ? { ...examples, ...floatExamples } : examples,
		instructions: [...installed, ...DIRECTIVES], instructionHelp, comments: ['*'],
		tokenPattern: /[A-Za-z@#$_][\w@#$]*|\d+/g,
		editor, characterSet: { name: 'EBCDIC', decode: byte => EBCDIC_TO_UNICODE[byte & 255], encode: code => unicodeToEbcdic(code) },
		reset(cpu) {
			cpu.memory.set([0x0a, 0x03], EXIT_STUB)
			cpu.r[13] = SAVE_AREA; cpu.r[14] = EXIT_STUB; cpu.r[15] = cpu.pc
			cpu.r[IA] = cpu.pc
		},
		afterInstruction(cpu) { cpu.r[IA] = cpu.pc },
		setProgramCounter(cpu, address) { cpu.pc = address; cpu.r[IA] = address },
		instructionSize: mnemonic => { const opcode = opcodes.get(mnemonic.toUpperCase()); return opcode ? lengthOf(opcode.op) : 0 },
		encode: (mnemonic, operands, context) => encodeAbsolute(mnemonic, operands, context.value),
		decode: (memory, address) => decodeInstruction(memory, address, model),
		assemble: sources => assemble(sources, { model, origin: ORIGIN, modelName: label }),
	}
}

const MODEL_30 = '360-30'
const models = variantCatalog('360-50', {
	[MODEL_30]: { label: 'System/360 Model 30' },
	'360-50': { label: 'System/360 Model 50/65' },
	'370': { label: 'System/370' },
})
const model30 = (settings: TargetSettings) => settings.cpuModel === MODEL_30
const feature = (key: 'decimal' | 'floatingPoint', label: string) => ({
	key, group: 'CPU', role: 'variant' as const, label, rebuild: true,
	hint: 'Optional on the Model 30; standard on the Model 50/65 and System/370.',
	control: { kind: 'choice' as const, options: [{ value: true, label: 'Installed' }, { value: false, label: 'Not installed', when: model30 }] },
	isValid: (value: unknown) => typeof value === 'boolean',
})
const settings = defineSettings({
	defaults: { cpuModel: '360-50', decimal: true, floatingPoint: true },
	fields: [variantSetting('cpuModel', models), feature('decimal', 'Decimal feature'), feature('floatingPoint', 'Floating-point feature')],
	details: group => group === 'CPU' ? ['Functional execution in the BC-mode problem state; timing, I/O channels and interruption handlers are not simulated.'] : [],
})

const variants: Variant[] = [
	...[false, true].flatMap(decimal => [false, true].map(float => ({
		id: `30${decimal ? '-dec' : ''}${float ? '-fp' : ''}`,
		label: `System/360 Model 30${decimal || float ? ` with ${[decimal ? 'decimal' : '', float ? 'floating-point' : ''].filter(Boolean).join(' and ')} feature${decimal && float ? 's' : ''}` : ''}`,
		model: { features: (decimal ? DECIMAL : 0) | (float ? FLOAT : 0) },
	}))),
	{ id: '50', label: 'System/360 Model 50/65', model: { features: DECIMAL | FLOAT } },
	{ id: '370', label: 'System/370', model: { features: DECIMAL | FLOAT | S370 } },
]

export default createConfiguredFamily({
	id: manifest.id, name: manifest.name, defaultModel: '50', settings,
	selectModel: settings => {
		const model = models.valid(settings.cpuModel) ? settings.cpuModel : '360-50'
		if (model !== MODEL_30) return model === '370' ? '370' : '50'
		return `30${settings.decimal !== false ? '-dec' : ''}${settings.floatingPoint !== false ? '-fp' : ''}`
	},
	models: Object.fromEntries(variants.map(variant => [variant.id, { label: variant.label, configuration: configuration(variant) }])),
})
