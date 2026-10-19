import { describe, expect, it } from 'vitest'
import { validSettings } from '../../../core/settings'
import { isMappedAddress, MEMORY_CONFIGURATIONS } from '../memoryConfigurations'
import { DEFAULT_MIPS_SETTINGS, MIPS_SETTINGS, type MipsSettings } from '../settings'

// The MARS options only MIPS reads, line for line from Settings.properties.
describe('DEFAULT_MIPS_SETTINGS', () => {
	it('matches Settings.properties line for line', () => {
		expect(DEFAULT_MIPS_SETTINGS).toEqual<MipsSettings>({
			delayedBranching: false, // DelayedBranching = false
			extendedAssembler: true, // ExtendedAssembler = true
			warningsAreErrors: false, // WarningsAreErrors = false
			startAtMain: false, // StartAtMain = false
			selfModifyingCode: false, // not in Settings.properties; the static default is false
			bareMachine: false, // BareMachine = false
			exceptionHandler: '', // ExceptionHandler not in Settings.properties; the static default is empty
			programArguments: false, // ProgramArguments = false
			programArgumentsText: '', // not a settings key; the argument string is kept separately
			memoryConfiguration: 'default', // MemoryConfiguration not in Settings.properties; the static default resolves to the first (Default) configuration
		})
	})

	it('declares a field for every setting, each accepting its default', () => {
		expect(MIPS_SETTINGS.fields.map((field) => field.key).sort()).toEqual(Object.keys(DEFAULT_MIPS_SETTINGS).sort())
		for (const field of MIPS_SETTINGS.fields) expect(field.isValid(MIPS_SETTINGS.defaults[field.key])).toBe(true)
	})
})

describe('MIPS field validators', () => {
	const valid = (stored: Partial<Record<keyof MipsSettings, unknown>>) => validSettings(MIPS_SETTINGS, stored) as MipsSettings

	it('rejects wrong-typed values for boolean settings', () => {
		for (const key of ['delayedBranching', 'extendedAssembler', 'warningsAreErrors', 'startAtMain',
			'selfModifyingCode', 'bareMachine', 'programArguments'] as const) {
			for (const wrong of ['true', 1, undefined]) expect(valid({ [key]: wrong })[key]).toBe(DEFAULT_MIPS_SETTINGS[key])
		}
	})

	it('accepts any string as an exception handler path, and nothing else', () => {
		expect(valid({ exceptionHandler: 'handlers/myHandler.asm' }).exceptionHandler).toBe('handlers/myHandler.asm')
		expect(valid({ exceptionHandler: 0, programArgumentsText: null })).toEqual(DEFAULT_MIPS_SETTINGS)
	})

	it('rejects a memoryConfiguration outside the three named configurations', () => {
		for (const name of ['default', 'dataBasedCompact', 'textBasedCompact']) expect(valid({ memoryConfiguration: name }).memoryConfiguration).toBe(name)
		for (const wrong of ['compact', '', 0]) expect(valid({ memoryConfiguration: wrong }).memoryConfiguration).toBe('default')
	})
})

// All 21 fields of each configuration, transcribed in field order.
describe('MEMORY_CONFIGURATIONS', () => {
	it('default matches the transcribed default configuration', () => {
		expect(MEMORY_CONFIGURATIONS.default).toEqual({
			textBaseAddress: 0x00400000,
			dataSegmentBaseAddress: 0x10000000,
			externBaseAddress: 0x10000000,
			globalPointer: 0x10008000,
			dataBaseAddress: 0x10010000,
			heapBaseAddress: 0x10040000,
			stackPointer: 0x7fffeffc,
			stackBaseAddress: 0x7ffffffc,
			userHighAddress: 0x7fffffff,
			kernelBaseAddress: 0x80000000,
			kernelTextBaseAddress: 0x80000000,
			exceptionHandlerAddress: 0x80000180,
			kernelDataBaseAddress: 0x90000000,
			memoryMapBaseAddress: 0xffff0000,
			kernelHighAddress: 0xffffffff,
			dataSegmentLimitAddress: 0x7fffffff,
			textLimitAddress: 0x0ffffffc,
			kernelDataSegmentLimitAddress: 0xfffeffff,
			kernelTextLimitAddress: 0x8ffffffc,
			stackLimitAddress: 0x10040000,
			memoryMapLimitAddress: 0xffffffff,
		})
	})

	it('dataBasedCompact matches the transcribed data-based compact configuration', () => {
		expect(MEMORY_CONFIGURATIONS.dataBasedCompact).toEqual({
			textBaseAddress: 0x00003000,
			dataSegmentBaseAddress: 0x00000000,
			externBaseAddress: 0x00001000,
			globalPointer: 0x00001800,
			dataBaseAddress: 0x00000000,
			heapBaseAddress: 0x00002000,
			stackPointer: 0x00002ffc,
			stackBaseAddress: 0x00002ffc,
			userHighAddress: 0x00003fff,
			kernelBaseAddress: 0x00004000,
			kernelTextBaseAddress: 0x00004000,
			exceptionHandlerAddress: 0x00004180,
			kernelDataBaseAddress: 0x00005000,
			memoryMapBaseAddress: 0x00007f00,
			kernelHighAddress: 0x00007fff,
			dataSegmentLimitAddress: 0x00002fff,
			textLimitAddress: 0x00003ffc,
			kernelDataSegmentLimitAddress: 0x00007eff,
			kernelTextLimitAddress: 0x00004ffc,
			stackLimitAddress: 0x00002000,
			memoryMapLimitAddress: 0x00007fff,
		})
	})

	it('textBasedCompact matches the transcribed text-based compact configuration', () => {
		expect(MEMORY_CONFIGURATIONS.textBasedCompact).toEqual({
			textBaseAddress: 0x00000000,
			dataSegmentBaseAddress: 0x00001000,
			externBaseAddress: 0x00001000,
			globalPointer: 0x00001800,
			dataBaseAddress: 0x00002000,
			heapBaseAddress: 0x00003000,
			stackPointer: 0x00003ffc,
			stackBaseAddress: 0x00003ffc,
			userHighAddress: 0x00003fff,
			kernelBaseAddress: 0x00004000,
			kernelTextBaseAddress: 0x00004000,
			exceptionHandlerAddress: 0x00004180,
			kernelDataBaseAddress: 0x00005000,
			memoryMapBaseAddress: 0x00007f00,
			kernelHighAddress: 0x00007fff,
			dataSegmentLimitAddress: 0x00003fff,
			textLimitAddress: 0x00000ffc,
			kernelDataSegmentLimitAddress: 0x00007eff,
			kernelTextLimitAddress: 0x00004ffc,
			stackLimitAddress: 0x00003000,
			memoryMapLimitAddress: 0x00007fff,
		})
	})

	it('puts the stack inside the data segment for protection purposes', () => {
		// dataSegmentBase = 0x10000000, dataSegmentLimit = 0x7fffffff: the stack
		// (base 0x7ffffffc) is faithfully inside that range, not a bug to "fix".
		const { dataSegmentBaseAddress, dataSegmentLimitAddress, stackBaseAddress } = MEMORY_CONFIGURATIONS.default
		expect(stackBaseAddress).toBeGreaterThan(dataSegmentBaseAddress)
		expect(stackBaseAddress).toBeLessThanOrEqual(dataSegmentLimitAddress)
	})

	it('gives each configuration all 21 fields', () => {
		for (const config of Object.values(MEMORY_CONFIGURATIONS)) {
			expect(Object.keys(config)).toHaveLength(21)
		}
	})

	it('places the exception handler at 0x80000180 in default but 0x00004180 in both compact configurations', () => {
		expect(MEMORY_CONFIGURATIONS.default.exceptionHandlerAddress).toBe(0x80000180)
		expect(MEMORY_CONFIGURATIONS.dataBasedCompact.exceptionHandlerAddress).toBe(0x00004180)
		expect(MEMORY_CONFIGURATIONS.textBasedCompact.exceptionHandlerAddress).toBe(0x00004180)
	})
})

describe('what counts as an address', () => {
	const layout = MEMORY_CONFIGURATIONS.default

	it('rejects the value most registers hold', () => {
		// Zero sits below the text base in every configuration, so a file of empty
		// registers names no address at all.
		expect(isMappedAddress(0, layout)).toBe(false)
		expect(isMappedAddress(1, layout)).toBe(false)
	})

	it('accepts an address in user space or the kernel', () => {
		expect(isMappedAddress(layout.textBaseAddress, layout)).toBe(true)
		expect(isMappedAddress(layout.dataBaseAddress, layout)).toBe(true)
		expect(isMappedAddress(layout.stackPointer, layout)).toBe(true)
		// The memory-mapped devices sit inside the kernel range, above 0x7fffffff,
		// so the comparison has to be unsigned.
		expect(isMappedAddress(layout.memoryMapBaseAddress, layout)).toBe(true)
		expect(isMappedAddress(layout.kernelHighAddress, layout)).toBe(true)
	})

	it('rejects everything below the text base, which is the only unmapped region', () => {
		// User space runs to 0x7fffffff and the kernel starts at 0x80000000, so the
		// two are contiguous: what is left out is only the space beneath the text.
		expect(isMappedAddress(layout.textBaseAddress - 4, layout)).toBe(false)
		expect(isMappedAddress(layout.userHighAddress + 1, layout)).toBe(true)
	})
})
