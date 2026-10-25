import { htmlReference } from './htmlReferences'
import type { RegisterDescriptor } from '../contracts'
import { cpuHistorySchema, type CpuConfiguration } from '../../core/configuredCpu'
import { createConfiguredFamily } from '../../core/configuredFamily'
import { defineSettings, type TargetSettings } from '../../core/settings'
import { variantCatalog, variantSetting } from '../../core/variants'
import { assemble } from './assembler'
import { examples, eisExamples, fp11Examples, fisExamples } from './examples'
import { instructionHelp, instructionLink } from './instructionHelp'
import { manifest } from './manifest'
import { AC, decode, encode, FEA, FEC, featuresOf, FPS, FPS_WRITABLE, instructionSize, instructionsFor, IO_PAGE, MODEL_NAMES, PSW, readAc, SP, writeAc, type FloatOption, type Model } from './isa'

const general: RegisterDescriptor[] = [
	...['r0', 'r1', 'r2', 'r3', 'r4', 'r5'].map((id, index) => ({ id, name: id.toUpperCase(), aliases: [`%${index}`], bank: 'cpu', bits: 16, editable: true })),
	{ id: 'sp', name: 'SP', aliases: ['r6', '%6'], bank: 'cpu', bits: 16, editable: true, role: 'stackPointer' },
	{ id: 'psw', name: 'PSW', bank: 'cpu', bits: 16, editable: true, role: 'flags' },
]
const status: RegisterDescriptor[] = [
	{ id: 'fps', name: 'FPS', bank: 'FP11', group: 'Status', bits: 16, editable: true },
	{ id: 'fec', name: 'FEC', bank: 'FP11', group: 'Status', bits: 16, editable: true },
	{ id: 'fea', name: 'FEA', bank: 'FP11', group: 'Status', bits: 16, editable: true },
]
// Each accumulator is shown as its D memory image, so the shared DEC reading applies.
const accumulators: RegisterDescriptor[] = Array.from({ length: 6 }, (_, n) => ({ id: `ac${n}`, name: `AC${n}`, aliases: [`f${n}`], bank: 'FP11', group: 'Accumulators', bits: 64, editable: true, floatEncoding: 'dec' }))
const accumulatorWords: RegisterDescriptor[] = Array.from({ length: 12 }, (_, i) => ({ id: `acword${i}`, name: `AC${i >> 1} ${i & 1 ? 'low' : 'high'}`, bank: 'FP11', bits: 32, editable: false }))

/** The memory image (first word lowest) of a sign-first D value, and back. */
function image(raw: bigint): bigint {
	let value = 0n
	for (let i = 0; i < 4; i++) value |= (raw >> BigInt(48 - 16 * i) & 0xffffn) << BigInt(16 * i)
	return value
}
const fromImage = image

function writeGeneral(cpu: Parameters<NonNullable<CpuConfiguration['writeRegister']>>[0], index: number, value: number) {
	cpu.r[index] = index === PSW ? value & 0o377 : index === FPS ? value & FPS_WRITABLE : index === FEC ? value & 15 : value & 0xffff
}

function configuration(model: Model, float: FloatOption): CpuConfiguration {
	const features = featuresOf(model, float), fp11 = features.fp11
	const name = `${MODEL_NAMES[model]}${float === 'fis' ? ' + FIS' : fp11 ? ' + FP11' : ''}`
	const native = fp11 ? [...general, ...status, ...accumulatorWords] : general
	return {
		id: manifest.id, name, language: `thrax-pdp11-${model}${float === 'none' ? '' : `-${float}`}`, reference: htmlReference,
		registers: native,
		registerView: fp11 ? {
			registers: [...general, ...status, ...accumulators],
			read: (words, index) => index < AC ? words[index] : image(readAc(words, index - AC)),
			write(cpu, index, value) {
				if (index < AC) writeGeneral(cpu, index, Number(value))
				else writeAc(cpu, index - AC, fromImage(BigInt(value)), true)
			},
		} : undefined,
		pcBits: 16, memoryBytes: 0x10000, textBase: 0o1000, dataBase: 0o40000,
		wordBytes: 2, instructionAlignment: 2, littleEndian: true, displayRadix: 8,
		memorySections: [
			{ id: 'text', label: 'Code', start: 0, end: 0o37777, code: true },
			{ id: 'data', label: 'Data', start: 0o40000, end: IO_PAGE - 1 },
			{ id: 'io', label: 'I/O page', start: IO_PAGE, end: 0o177777 },
		],
		historySchema: cpuHistorySchema({ registers: native.length, wide: false, instructionBytes: 6 }),
		examples: { ...examples, ...(features.eis ? eisExamples : {}), ...(features.fis ? fisExamples : {}), ...(fp11 ? fp11Examples : {}) },
		instructions: instructionsFor(features), instructionHelp, instructionLink, comments: [';'],
		writeRegister(cpu, index, value) { writeGeneral(cpu, index, Number(value)) },
		reset(cpu) { cpu.r.fill(0); cpu.r[SP] = IO_PAGE },
		advance(cpu, size) { cpu.pc = cpu.pc + size & 0xffff },
		fallThrough: (cpu, size) => cpu.pc + size & 0xffff,
		fetchAddress: (_cpu, address, offset) => address + offset & 0xffff,
		instructionSize: (mnemonic, operands) => instructionSize(mnemonic, operands, features),
		encode: (mnemonic, operands, context) => encode(mnemonic, operands, context, features),
		decode: (memory, address) => decode(memory, address, features),
		assemble(sources) { return assemble(sources, this) },
	}
}

const models = variantCatalog('pdp1140', {
	'pdp1120': { label: 'PDP-11/20' }, 'pdp1140': { label: 'PDP-11/40' }, 'pdp1145': { label: 'PDP-11/45, 11/70' }, 'lsi1123': { label: 'LSI-11/23' },
})
const floats = (model: Model): FloatOption[] => model === 'pdp1140' ? ['none', 'fis'] : model === 'pdp1145' || model === 'lsi1123' ? ['none', 'fp11'] : ['none']
const modelOf = (settings: TargetSettings): Model => models.valid(settings.cpuModel) ? settings.cpuModel : 'pdp1140'

const settings = defineSettings({ defaults: { cpuModel: 'pdp1140', floatingPoint: 'none' }, fields: [
	variantSetting('cpuModel', models, 'Instructions a model lacks are assembler errors, and trap to vector 10 if executed.'),
	{ key: 'floatingPoint', group: 'CPU', role: 'variant', label: 'Floating point', rebuild: true,
		control: { kind: 'choice', options: [
			{ value: 'none', label: 'None' },
			{ value: 'fis', label: 'KE11-F floating instruction set (FIS)', when: s => floats(modelOf(s)).includes('fis') },
			{ value: 'fp11', label: 'FP11 floating-point processor', when: s => floats(modelOf(s)).includes('fp11') },
		] },
		isValid: (value: unknown) => value === 'none' || value === 'fis' || value === 'fp11' },
], details: group => group === 'CPU' ? ['Functional execution without an MMU: one 64 KB address space, kernel mode, the console DL11 at 177560 and no interrupts.'] : [] })

export default createConfiguredFamily({ id: manifest.id, name: manifest.name, defaultModel: 'pdp1140', settings,
	// A floating-point option the model cannot take falls back to none.
	selectModel: s => {
		const model = modelOf(s), float = s.floatingPoint as FloatOption
		return float !== 'none' && floats(model).includes(float) ? `${model}+${float}` : model
	},
	models: Object.fromEntries(models.options.flatMap(({ value, label }) => floats(value).map(float => [`${value}${float === 'none' ? '' : `+${float}`}`, { label, configuration: configuration(value, float) }]))),
})
