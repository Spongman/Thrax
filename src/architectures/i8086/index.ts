import { htmlReference } from './htmlReferences'
import { instructionHelp, instructionLink } from './instructionHelp'
import { cpuHistorySchema, type CpuConfiguration } from '../../core/configuredCpu'
import { createConfiguredFamily } from '../../core/configuredFamily'
import { defineSettings, type TargetSettings } from '../../core/settings'
import { variantCatalog, variantSetting } from '../../core/variants'
import { fpuRegisterView, fpuWords, reset8087, fpuInstructions, fpu387Instructions } from './fpu'
import { examples, examples186, fpuExamples, fpu187Examples } from './examples'
import { historySchema } from './history'
import { decode, encode, instructions, extendedInstructions, laterCpu, names, type CpuModel, type MathCoprocessor } from './isa'

const base: CpuConfiguration = {
	id: 'i8086', name: 'Intel 8086', language: 'thrax-i8086',
	reference: htmlReference,
	registers: names.map((name, index) => ({ id: name.toLowerCase(), name, bank: 'integer', bits: 16, editable: true, ...(index === 4 ? { role: 'stackPointer' as const } : index === 13 ? { role: 'flags' as const } : {}) })),
	pcBits: 20, memoryBytes: 0x100000, textBase: 0x1000, dataBase: 0x8000,
	wordBytes: 2, instructionAlignment: 1, littleEndian: true,
	historySchema, instructionHelp, instructionLink, examples, instructions, comments: [';'],
	decodeKey(cpu) { return cpu.r[9] },
	reset(cpu) { cpu.r[4] = 0xfffe; cpu.r[13] = 0xf002; if (cpu.pc > 65535) cpu.r[9] = cpu.pc >>> 4; cpu.r[12] = (cpu.pc - (cpu.r[9] << 4)) & 65535 },
	fetchAddress(cpu, address, offset) { return cpu.segmentAddress(cpu.r[9], address - (cpu.r[9] << 4) + offset) },
	advance(cpu, size) { cpu.r[12] = ((cpu.pc - (cpu.r[9] << 4)) + size) & 65535; cpu.pc = cpu.segmentAddress(cpu.r[9], cpu.r[12]) },
	fallThrough(cpu, size) { return cpu.segmentAddress(cpu.r[9], cpu.pc - (cpu.r[9] << 4) + size) },
	setProgramCounter(cpu, address) {
		const offset = (address - (cpu.r[9] << 4) + 0x100000) & 0xfffff
		if (offset > 65535) { cpu.r[9] = address >>> 4; cpu.r[12] = address & 15 }
		else cpu.r[12] = offset
		cpu.pc = cpu.segmentAddress(cpu.r[9], cpu.r[12])
	},
	writeRegister(cpu, index, value) { cpu.r[index] = Number(value) & 65535; if (index === 9 || index === 12) cpu.pc = cpu.segmentAddress(cpu.r[9], cpu.r[12]); if (index === 13) cpu.r[13] = (cpu.r[13] & 0x0fd5) | 0xf002 },
	instructionSize(mnemonic, operands) { return encode(mnemonic, operands, { address: 0, value: text => Number(text) || 0 }).length },
	encode, decode: (memory, address, cpu) => decode(memory, address, cpu),
}

const models = variantCatalog('8086', {
	'8086': { label: 'Intel 8086' }, '8088': { label: 'Intel 8088' },
	'80186': { label: 'Intel 80186' }, '80188': { label: 'Intel 80188' },
})
// The 80187 attaches only to an 80186/80188; those reach an 8087 through the 82188 bus controller.
const with186 = (settings: TargetSettings) => laterCpu(settings.cpuModel as CpuModel)
const coprocessors = (model: CpuModel): MathCoprocessor[] => ['none', '8087', ...(laterCpu(model) ? ['80187' as const] : [])]
const settings = defineSettings({ defaults: { cpuModel: '8086', coprocessor: 'none' }, fields: [
	variantSetting('cpuModel', models),
	{ key: 'coprocessor', group: 'CPU', role: 'variant', label: 'Math coprocessor', rebuild: true,
		control: { kind: 'choice', options: [{ value: 'none', label: 'None' }, { value: '8087', label: 'Intel 8087', when: settings => !with186(settings) },
			{ value: '8087', label: 'Intel 8087 (via 82188)', when: with186 }, { value: '80187', label: 'Intel 80187', when: with186 }] },
		isValid: (value: unknown) => value === 'none' || value === '8087' || value === '80187' },
], details: group => group === 'CPU' ? ['Functional execution; external bus widths, prefetch timing and integrated peripherals are not simulated.'] : [] })
function configuration(model: CpuModel, coprocessor: MathCoprocessor): CpuConfiguration {
	const fpu = coprocessor !== 'none', name = `Intel ${model}${fpu ? ` + ${coprocessor}` : ''}`
	return { ...base, name, language: `thrax-i${model}${fpu ? `-${coprocessor}` : ''}`,
		reference: htmlReference,
		examples: { ...(laterCpu(model) ? examples186 : examples), ...(fpu ? fpuExamples : {}), ...(coprocessor === '80187' ? fpu187Examples : {}) },
		tokenPattern: /ST\([0-7]\)|[%\w.$]+/gi,
		registers: fpu ? [...base.registers, ...Array.from({ length: fpuWords - 14 }, (_, index) => ({ id: `fpword${index}`, name: `FP word ${index}`, bits: 32, bank: coprocessor, editable: false }))] : base.registers,
		registerView: fpu ? fpuRegisterView(base.registers, (cpu, index, value) => base.writeRegister!(cpu, index, value), coprocessor) : undefined,
		historySchema: fpu ? cpuHistorySchema({ registers: fpuWords, wide: false, instructionBytes: 15 }) : historySchema,
		instructions: [...instructions, 'WAIT', 'FWAIT', ...(laterCpu(model) ? extendedInstructions : []), ...(fpu ? fpuInstructions : []), ...(coprocessor === '80187' ? fpu387Instructions : [])],
		reset(cpu) { base.reset!(cpu); if (fpu) reset8087(cpu, coprocessor) },
		instructionSize: (name, operands) => encode(name, operands, { address: 0, value: text => Number(text) || 0 }, model, coprocessor).length,
		encode: (name, operands, context) => encode(name, operands, context, model, coprocessor),
		decode: (memory, address, cpu) => decode(memory, address, cpu, model, coprocessor),
	}
}
export default createConfiguredFamily({ id: 'i8086', name: 'Intel x86', defaultModel: '8086', settings,
	// A coprocessor the CPU cannot take, such as an 80187 on an 8086, falls back to none.
	selectModel: settings => {
		const model = models.valid(settings.cpuModel) ? settings.cpuModel : '8086', coprocessor = settings.coprocessor as MathCoprocessor
		return coprocessor !== 'none' && coprocessors(model).includes(coprocessor) ? `${model}+${coprocessor}` : model
	},
	models: Object.fromEntries(models.options.flatMap(({ value, label }) => coprocessors(value).map(coprocessor => [`${value}${coprocessor === 'none' ? '' : `+${coprocessor}`}`, { label, configuration: configuration(value, coprocessor) }]))),
})
