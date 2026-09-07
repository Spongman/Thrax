import { describe, expect, it } from 'vitest'
import {
	DEFAULT_SETTINGS,
	isValidSettings,
	MAX_BACKSTEP_LIMIT,
	MEMORY_CONFIGURATIONS,
	SETTINGS_VALIDATORS,
	isMappedAddress,
	type ThraxSettings,
} from '../settings'

// Defaults, line for line, from Settings.properties, plus BackstepLimit, which
// is a Config.properties key rather than a Settings.properties one.  Every
// value matches the reference except where a comment says why it does not.
describe('DEFAULT_SETTINGS', () => {
	it('matches Settings.properties line for line', () => {
		expect(DEFAULT_SETTINGS).toEqual<ThraxSettings>({
			delayedBranching: false, // DelayedBranching = false
			extendedAssembler: true, // ExtendedAssembler = true
			warningsAreErrors: false, // WarningsAreErrors = false
			startAtMain: false, // StartAtMain = false
			selfModifyingCode: false, // not in Settings.properties; the static default is false
			bareMachine: false, // BareMachine = false
			exceptionHandler: '', // ExceptionHandler not in Settings.properties; the static default is empty
			assembleAll: false, // AssembleAll = false
			displayValuesInHex: true, // DisplayValuesInHex = true
			displayAddressesInHex: true, // DisplayAddressesInHex = true
			programArguments: false, // ProgramArguments = false
			programArgumentsText: '', // not a settings key; the argument string is kept separately
			memoryConfiguration: 'default', // MemoryConfiguration not in Settings.properties; the static default resolves to the first (Default) configuration
			// A deliberate departure: MARS keeps 2000 backstep *operations*, where
			// one instruction may push several.  THRAX keeps whole instructions,
			// at about 150 bytes each and no cost to the speed of a run, so the
			// default is what it takes to rewind a small program from its end.
			backstepLimit: 100_000,
			hexDimming: 'nibbles', // THRAX's own: how far a hex number's leading zeros are dimmed
			// THRAX's own, and on: a click that moves another panel is worth
			// following, and a value that moved is worth seeing move.
			highlightNavigation: true,
			highlightChanges: true,
			highlightSeconds: 0.3,
			highlightNavigationColor: '#4094ff',
			highlightChangeColor: '#f0a830',
		})
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

describe('SETTINGS_VALIDATORS', () => {
	it('accepts every default value', () => {
		for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof ThraxSettings>) {
			expect(SETTINGS_VALIDATORS[key](DEFAULT_SETTINGS[key])).toBe(true)
		}
	})

	it('rejects wrong-typed values for boolean settings', () => {
		for (const key of ['delayedBranching', 'extendedAssembler', 'warningsAreErrors', 'startAtMain',
			'selfModifyingCode', 'bareMachine', 'assembleAll', 'displayValuesInHex',
			'displayAddressesInHex', 'programArguments'] as const) {
			expect(SETTINGS_VALIDATORS[key]('true')).toBe(false)
			expect(SETTINGS_VALIDATORS[key](1)).toBe(false)
			expect(SETTINGS_VALIDATORS[key](undefined)).toBe(false)
		}
	})

	it('rejects wrong-typed values for string settings', () => {
		for (const key of ['exceptionHandler', 'programArgumentsText'] as const) {
			expect(SETTINGS_VALIDATORS[key](0)).toBe(false)
			expect(SETTINGS_VALIDATORS[key](null)).toBe(false)
			expect(SETTINGS_VALIDATORS[key](undefined)).toBe(false)
		}
	})

	it('accepts any string as an exception handler path, including empty', () => {
		expect(SETTINGS_VALIDATORS.exceptionHandler('')).toBe(true)
		expect(SETTINGS_VALIDATORS.exceptionHandler('handlers/myHandler.asm')).toBe(true)
	})

	it('rejects a memoryConfiguration outside the three named configurations', () => {
		expect(SETTINGS_VALIDATORS.memoryConfiguration('default')).toBe(true)
		expect(SETTINGS_VALIDATORS.memoryConfiguration('dataBasedCompact')).toBe(true)
		expect(SETTINGS_VALIDATORS.memoryConfiguration('textBasedCompact')).toBe(true)
		expect(SETTINGS_VALIDATORS.memoryConfiguration('compact')).toBe(false)
		expect(SETTINGS_VALIDATORS.memoryConfiguration('')).toBe(false)
		expect(SETTINGS_VALIDATORS.memoryConfiguration(0)).toBe(false)
	})

	it('rejects an out-of-range or wrong-typed backstepLimit', () => {
		expect(SETTINGS_VALIDATORS.backstepLimit(2000)).toBe(true)
		expect(SETTINGS_VALIDATORS.backstepLimit(1)).toBe(true)
		expect(SETTINGS_VALIDATORS.backstepLimit(MAX_BACKSTEP_LIMIT)).toBe(true)
		// Bounded, so a mistyped number cannot take the tab with it.
		expect(SETTINGS_VALIDATORS.backstepLimit(MAX_BACKSTEP_LIMIT + 1)).toBe(false)
		expect(SETTINGS_VALIDATORS.backstepLimit(0)).toBe(false)
		expect(SETTINGS_VALIDATORS.backstepLimit(-1)).toBe(false)
		expect(SETTINGS_VALIDATORS.backstepLimit(1.5)).toBe(false)
		expect(SETTINGS_VALIDATORS.backstepLimit('2000')).toBe(false)
	})
})

describe('isValidSettings', () => {
	it('accepts DEFAULT_SETTINGS', () => {
		expect(isValidSettings(DEFAULT_SETTINGS)).toBe(true)
	})

	it('rejects a settings object missing a field', () => {
		const { backstepLimit: _backstepLimit, ...partial } = DEFAULT_SETTINGS
		expect(isValidSettings(partial)).toBe(false)
	})

	it('rejects a settings object with one wrong-typed field', () => {
		expect(isValidSettings({ ...DEFAULT_SETTINGS, backstepLimit: -5 })).toBe(false)
		expect(isValidSettings({ ...DEFAULT_SETTINGS, memoryConfiguration: 'bogus' })).toBe(false)
	})

	it('rejects non-objects', () => {
		expect(isValidSettings(null)).toBe(false)
		expect(isValidSettings(undefined)).toBe(false)
		expect(isValidSettings('settings')).toBe(false)
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
