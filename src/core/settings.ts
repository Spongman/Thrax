/**
 * IDE-level settings, each keyed by the name it persists under, and the schema
 * an architecture declares its own settings with.
 *
 * Pure model: no React, no store, no wiring into the assembler or simulator.
 * Consumers read `ThraxSettings` and apply the effects themselves.
 */

/**
 * How far a hex number's leading zeros are dimmed.  `nibbles` dims every zero
 * digit; `bytes` and `halfwords` dim only whole units of that size, so a lone
 * zero that does not fill one stays bright and the dimmed run lines up with the
 * shape of the value.  `pow2` works from the other end: it leaves a power-of-two
 * number of digits standing, so what survives is always 1, 2, 4 or 8 wide.
 */
export const HEX_DIMMING_MODES = ['off', 'nibbles', 'bytes', 'halfwords', 'pow2'] as const

export type HexDimming = (typeof HEX_DIMMING_MODES)[number]

/** Settings every architecture shares. */
export interface ThraxSettings {
	/** Assemble every open file, where the architecture takes several entries. */
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
	assembleAll: false,
	displayValuesInHex: true,
	displayAddressesInHex: true,
	hexDimming: 'nibbles',
	highlightNavigation: true,
	highlightChanges: true,
	highlightSeconds: 0.3,
	highlightNavigationColor: '#4094ff',
	highlightChangeColor: '#f0a830',
	backstepLimit: DEFAULT_BACKSTEP_LIMIT,
}

/**
 * A fade shorter than this is a blink rather than something to follow, and one
 * longer outlives the step that caused it.
 */
export const MIN_HIGHLIGHT_SECONDS = 0.2
export const MAX_HIGHLIGHT_SECONDS = 10

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
/** `#rrggbb`, which is what a colour input produces and what the fade parses. */
const isHexColor = (value: unknown): value is string =>
	typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
export const isString = (value: unknown): value is string => typeof value === 'string'
const isPositiveInteger = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value > 0

/** Per-field validators, in the shape `ToolSetting.isValid` consumers expect. */
export const SETTINGS_VALIDATORS: { [Key in keyof ThraxSettings]: (value: unknown) => boolean } = {
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
	backstepLimit: (value: unknown): value is number => isPositiveInteger(value) && value <= MAX_BACKSTEP_LIMIT,
}

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Whether every field of `value` is present and passes its own validator. */
export function isValidSettings(value: unknown): value is ThraxSettings {
	if (!isRecord(value)) return false
	return (Object.keys(DEFAULT_SETTINGS) as Array<keyof ThraxSettings>)
		.every((key) => SETTINGS_VALIDATORS[key](value[key]))
}

/* ------------------------------------------------- architecture settings */

/** An architecture's own settings, by field name. */
export type TargetSettings = Record<string, unknown>

/** How the settings dialog edits a field. */
export type SettingControl =
	| { kind: 'check' }
	| { kind: 'text', placeholder?: string }
	/** One of a fixed list; values compare by identity. */
	| { kind: 'choice', options: readonly { value: unknown, label: string }[] }

/** One field of an architecture's settings. */
export interface SettingField<Settings extends TargetSettings = TargetSettings> {
	key: keyof Settings & string
	/** Dialog group it is shown in; one titled like a shared group joins it. */
	group: string
	label: string
	hint?: string
	control: SettingControl
	isValid(value: unknown): boolean
	/** Read when assembling or building the machine, so a change drops the program. */
	rebuild?: boolean
	/** A boolean field that must be on for this one to be editable. */
	enabledBy?: keyof Settings & string
	/** Where the value was stored before settings were per architecture. */
	legacyKey?: string
}

/** The settings an architecture declares, and how the dialog shows them. */
export interface ArchitectureSettings<Settings extends TargetSettings = TargetSettings> {
	defaults: Settings
	/** In dialog order; groups appear in the order their first field does. */
	fields: readonly SettingField<Settings>[]
	/** Read-only lines shown under a group, such as what a choice resolves to. */
	details?(group: string, settings: Settings): readonly string[]
}

/**
 * Checks a schema against the settings type it describes, then erases that
 * type: shared code reads every architecture's settings alike.
 */
export const defineSettings = <Settings extends TargetSettings>(schema: ArchitectureSettings<Settings>) =>
	schema as unknown as ArchitectureSettings

/** Each field as stored, or its default where that is missing or invalid. */
export function validSettings<Settings extends TargetSettings>(schema: ArchitectureSettings<Settings>, stored: unknown): Settings {
	const values: TargetSettings = { ...schema.defaults }
	if (!isRecord(stored)) return values as Settings
	for (const field of schema.fields) {
		if (field.isValid(stored[field.key])) values[field.key] = stored[field.key]
	}
	return values as Settings
}
