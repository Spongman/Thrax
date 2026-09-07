/**
 * IDE-level settings, each keyed by the name it persists under.
 *
 * Pure model: no React, no store, no wiring into the assembler or simulator.
 * Consumers read `ThraxSettings` and apply the effects themselves.
 */

/** The three memory layouts, by identifier. */
export type MemoryConfigurationName = 'default' | 'dataBasedCompact' | 'textBasedCompact'

/**
 * All 21 addresses of one memory configuration, in field order.
 */
export interface MemoryConfigurationValues {
	textBaseAddress: number
	dataSegmentBaseAddress: number
	externBaseAddress: number
	globalPointer: number
	dataBaseAddress: number
	heapBaseAddress: number
	stackPointer: number
	stackBaseAddress: number
	userHighAddress: number
	kernelBaseAddress: number
	kernelTextBaseAddress: number
	exceptionHandlerAddress: number
	kernelDataBaseAddress: number
	memoryMapBaseAddress: number
	kernelHighAddress: number
	dataSegmentLimitAddress: number
	textLimitAddress: number
	kernelDataSegmentLimitAddress: number
	kernelTextLimitAddress: number
	stackLimitAddress: number
	memoryMapLimitAddress: number
}

/**
 * Whether `value` is an address the configuration maps, rather than a number
 * that happens to be in a register.
 *
 * Most registers hold a small integer or nothing at all, so treating every
 * register's contents as an address makes the whole file light the moment one
 * of them is pointed at: zero is in thirty of them at once.  Only a value
 * inside user space or the kernel is worth calling an address.
 */
export function isMappedAddress(value: number, layout: MemoryConfigurationValues): boolean {
	const address = value >>> 0
	return (address >= (layout.textBaseAddress >>> 0) && address <= (layout.userHighAddress >>> 0))
		|| (address >= (layout.kernelBaseAddress >>> 0) && address <= (layout.kernelHighAddress >>> 0))
}

/** SPIM-derived layout, used by default. */
const DEFAULT_CONFIGURATION: MemoryConfigurationValues = {
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
}

/** 16-bit addressing, data segment starts at 0. */
const DATA_BASED_COMPACT_CONFIGURATION: MemoryConfigurationValues = {
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
}

/** 16-bit addressing, text segment starts at 0. */
const TEXT_BASED_COMPACT_CONFIGURATION: MemoryConfigurationValues = {
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
}

export const MEMORY_CONFIGURATIONS: Record<MemoryConfigurationName, MemoryConfigurationValues> = {
	default: DEFAULT_CONFIGURATION,
	dataBasedCompact: DATA_BASED_COMPACT_CONFIGURATION,
	textBasedCompact: TEXT_BASED_COMPACT_CONFIGURATION,
}

/** IDE-level settings, each keyed to the behaviour it selects. */
/**
 * How far a hex number's leading zeros are dimmed.  `nibbles` dims every zero
 * digit; `bytes` and `halfwords` dim only whole units of that size, so a lone
 * zero that does not fill one stays bright and the dimmed run lines up with the
 * shape of the value.  `pow2` works from the other end: it leaves a power-of-two
 * number of digits standing, so what survives is always 1, 2, 4 or 8 wide.
 */
export const HEX_DIMMING_MODES = ['off', 'nibbles', 'bytes', 'halfwords', 'pow2'] as const

export type HexDimming = (typeof HEX_DIMMING_MODES)[number]

export interface ThraxSettings {
	/** Statement after a taken branch runs first (`DelayedBranching`). */
	delayedBranching: boolean
	/** Off rejects pseudo-instructions and extended operand forms (`ExtendedAssembler`). */
	extendedAssembler: boolean
	/** Assembly warnings become errors (`WarningsAreErrors`). */
	warningsAreErrors: boolean
	/** Entry point is `main` rather than the configuration's text base (`StartAtMain`). */
	startAtMain: boolean
	/** Gates text-segment writes and out-of-text fetches (`SelfModifyingCode`). */
	selfModifyingCode: boolean
	/** Off is current behaviour; on limits to bare-machine forms (`BareMachine`). */
	bareMachine: boolean
	/**
	 * Source file prepended to the assembly (`ExceptionHandler`, a string
	 * setting). Empty means none.  Not a dispatch switch: a handler at the
	 * exception address is entered whenever one is loaded, so there is no
	 * "enable exceptions" flag to model.
	 */
	exceptionHandler: string
	/** Assemble every file in the active file's directory (`AssembleAll`). */
	assembleAll: boolean
	/** Seeds the registers/memory panels' default radix (`DisplayValuesInHex`). */
	displayValuesInHex: boolean
	/** Seeds the memory panel's default radix (`DisplayAddressesInHex`). */
	displayAddressesInHex: boolean
	/** How much of a hex number's leading zero run is dimmed. */
	hexDimming: HexDimming
	/**
	 * A panel flashes where a click sent the eye: the register, word or source
	 * line just navigated to.  Two panels are involved in one navigation and the
	 * destination is rarely where the pointer is, so without it the answer has to
	 * be searched for.
	 */
	highlightNavigation: boolean
	/**
	 * A value flashes where it is shown when the last step changed it.  Separate
	 * from the navigation flash, and a different colour, because the two answer
	 * different questions: where did I just go, and what just moved.
	 */
	highlightChanges: boolean
	/**
	 * How long a highlight takes to fade.  Long enough to be followed rather than
	 * caught: the eye is usually elsewhere when the flash starts, since the click
	 * that caused it was in another panel.
	 */
	highlightSeconds: number
	/** The two highlight colours, as `#rrggbb`; the fade supplies the alpha. */
	highlightNavigationColor: string
	highlightChangeColor: string
	/**
	 * Enables the program-argument text field (`ProgramArguments`, a boolean).
	 * The argument string itself is separate and is not a persisted setting.
	 */
	programArguments: boolean
	/** The argument string used when `programArguments` is on. */
	programArgumentsText: string
	/** Which of `MEMORY_CONFIGURATIONS` lays out memory (`MemoryConfiguration`). */
	memoryConfiguration: MemoryConfigurationName
	/**
	 * Instructions the history keeps, and so how far back a run can be stepped.
	 * An entry costs about 370 bytes, measured over both arithmetic and
	 * store-heavy code, so the default holds a whole small program at around
	 * 37 MB and the maximum covers an uninterrupted run.
	 */
	backstepLimit: number
}

/**
 * How far back a run can be stepped, by default and at most.  The maximum is
 * the same as the instruction count a run pauses at, so the history can cover
 * one uninterrupted run and no more; past that the memory is the user's to
 * spend, and a bound keeps a mistyped number from taking the tab with it.
 */
export const DEFAULT_BACKSTEP_LIMIT = 100_000
export const MAX_BACKSTEP_LIMIT = 1_000_000

export const DEFAULT_SETTINGS: ThraxSettings = {
	delayedBranching: false,
	extendedAssembler: true,
	warningsAreErrors: false,
	startAtMain: false,
	selfModifyingCode: false,
	bareMachine: false,
	exceptionHandler: '',
	assembleAll: false,
	displayValuesInHex: true,
	displayAddressesInHex: true,
	hexDimming: 'nibbles',
	highlightNavigation: true,
	highlightChanges: true,
	highlightSeconds: 0.3,
	highlightNavigationColor: '#4094ff',
	highlightChangeColor: '#f0a830',
	programArguments: false,
	programArgumentsText: '',
	memoryConfiguration: 'default',
	backstepLimit: DEFAULT_BACKSTEP_LIMIT,
}

/**
 * A fade shorter than this is a blink rather than something to follow, and one
 * longer outlives the step that caused it.
 */
export const MIN_HIGHLIGHT_SECONDS = 0.2
export const MAX_HIGHLIGHT_SECONDS = 10

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
/** `#rrggbb`, which is what a colour input produces and what the fade parses. */
const isHexColor = (value: unknown): value is string =>
	typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isPositiveInteger = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value > 0

const MEMORY_CONFIGURATION_NAMES: readonly MemoryConfigurationName[] = ['default', 'dataBasedCompact', 'textBasedCompact']
const isMemoryConfigurationName = (value: unknown): value is MemoryConfigurationName =>
	typeof value === 'string' && (MEMORY_CONFIGURATION_NAMES as readonly string[]).includes(value)

/** Per-field validators, in the shape `ToolSetting.isValid` consumers expect. */
export const SETTINGS_VALIDATORS: { [Key in keyof ThraxSettings]: (value: unknown) => boolean } = {
	delayedBranching: isBoolean,
	extendedAssembler: isBoolean,
	warningsAreErrors: isBoolean,
	startAtMain: isBoolean,
	selfModifyingCode: isBoolean,
	bareMachine: isBoolean,
	exceptionHandler: isString,
	assembleAll: isBoolean,
	displayValuesInHex: isBoolean,
	displayAddressesInHex: isBoolean,
	hexDimming: (value) => typeof value === 'string' && (HEX_DIMMING_MODES as readonly string[]).includes(value),
	highlightNavigation: isBoolean,
	highlightChanges: isBoolean,
	highlightSeconds: (value): value is number =>
		typeof value === 'number' && Number.isFinite(value) && value >= MIN_HIGHLIGHT_SECONDS && value <= MAX_HIGHLIGHT_SECONDS,
	highlightNavigationColor: isHexColor,
	highlightChangeColor: isHexColor,
	programArguments: isBoolean,
	programArgumentsText: isString,
	memoryConfiguration: isMemoryConfigurationName,
	backstepLimit: (value: unknown): value is number => isPositiveInteger(value) && value <= MAX_BACKSTEP_LIMIT,
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Whether every field of `value` is present and passes its own validator. */
export function isValidSettings(value: unknown): value is ThraxSettings {
	if (!isRecord(value)) return false
	return (Object.keys(DEFAULT_SETTINGS) as Array<keyof ThraxSettings>)
		.every((key) => SETTINGS_VALIDATORS[key](value[key]))
}
