/** The MARS options MIPS reads, and how the settings dialog shows them. */

import { formatWord } from '../../core/format'
import { defineSettings, isBoolean, isString } from '../../core/settings'
import { isMemoryConfigurationName, MEMORY_CONFIGURATIONS, type MemoryConfigurationName } from './memoryConfigurations'

export type MipsSettings = {
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
	/** Enables the program-argument text field (`ProgramArguments`). */
	programArguments: boolean
	/** The argument string used when `programArguments` is on. */
	programArgumentsText: string
	/** Which of `MEMORY_CONFIGURATIONS` lays out memory (`MemoryConfiguration`). */
	memoryConfiguration: MemoryConfigurationName
}

export const DEFAULT_MIPS_SETTINGS: MipsSettings = {
	delayedBranching: false,
	extendedAssembler: true,
	warningsAreErrors: false,
	startAtMain: false,
	selfModifyingCode: false,
	bareMachine: false,
	exceptionHandler: '',
	programArguments: false,
	programArgumentsText: '',
	memoryConfiguration: 'default',
}

const MEMORY_GROUP = 'Memory configuration'

/**
 * Keys are the ones these options had before settings were per architecture,
 * so a choice made then carries over.
 */
export const MIPS_SETTINGS = defineSettings<MipsSettings>({
	defaults: DEFAULT_MIPS_SETTINGS,
	fields: [
		{
			key: 'extendedAssembler', group: 'Assembler', control: { kind: 'check' }, isValid: isBoolean, rebuild: true, legacyKey: 'assemble.extended',
			label: 'Permit extended (pseudo) instructions and formats',
			hint: 'Off assembles only the basic MIPS instruction set',
		},
		{
			key: 'startAtMain', group: 'Assembler', control: { kind: 'check' }, isValid: isBoolean, rebuild: true, legacyKey: 'assemble.startAtMain',
			label: 'Initialize the program counter to global \'main\' if defined',
			hint: 'Off starts at the text base of the memory configuration',
		},
		{
			key: 'warningsAreErrors', group: 'Assembler', control: { kind: 'check' }, isValid: isBoolean, rebuild: true, legacyKey: 'assemble.warningsAreErrors',
			label: 'Assembler warnings are considered errors',
			hint: 'A warning stops the assembly rather than annotating it',
		},
		{
			key: 'exceptionHandler', group: 'Assembler', control: { kind: 'text', placeholder: 'none' }, isValid: isString, rebuild: true, legacyKey: 'assemble.exceptionHandler',
			label: 'Exception handler',
			hint: 'Source file prepended to every assembly; empty means none',
		},
		{
			key: 'delayedBranching', group: 'Simulator', control: { kind: 'check' }, isValid: isBoolean, rebuild: true, legacyKey: 'assemble.delayedBranching',
			label: 'Delayed branching',
			hint: 'Run the instruction after a branch or jump before control transfers, as real MIPS hardware does',
		},
		{
			// Read once when the simulator is built, so a change needs a fresh one.
			key: 'selfModifyingCode', group: 'Simulator', control: { kind: 'check' }, isValid: isBoolean, rebuild: true, legacyKey: 'simulate.selfModifyingCode',
			label: 'Self-modifying code',
			hint: 'Permit writes into the text segment and execution outside it',
		},
		{
			key: 'bareMachine', group: 'Simulator', control: { kind: 'check' }, isValid: isBoolean, rebuild: true, legacyKey: 'assemble.bareMachine',
			label: 'Bare machine',
			hint: 'Allow only the instructions real hardware implements',
		},
		{
			key: 'programArguments', group: 'Simulator', control: { kind: 'check' }, isValid: isBoolean, legacyKey: 'simulate.programArguments',
			label: 'Program arguments provided to the program',
			hint: 'Place the arguments below on the stack, with their count in $a0',
		},
		{
			key: 'programArgumentsText', group: 'Simulator', control: { kind: 'text' }, isValid: isString, enabledBy: 'programArguments', legacyKey: 'simulate.programArgumentsText',
			label: 'Arguments',
			hint: 'Arguments passed to the program, separated by spaces',
		},
		{
			key: 'memoryConfiguration', group: MEMORY_GROUP, isValid: isMemoryConfigurationName, rebuild: true, legacyKey: 'memory.configuration',
			control: {
				kind: 'choice',
				options: [
					{ value: 'default', label: 'Default' },
					{ value: 'dataBasedCompact', label: 'Compact, data at address 0' },
					{ value: 'textBasedCompact', label: 'Compact, text at address 0' },
				],
			},
			label: 'Layout',
			hint: 'Where the segments of the address space start',
		},
	],
	details(group, settings) {
		if (group !== MEMORY_GROUP) return []
		const layout = MEMORY_CONFIGURATIONS[settings.memoryConfiguration]
		return [
			`.text ${formatWord(layout.textBaseAddress)}`,
			`.data ${formatWord(layout.dataBaseAddress)}`,
			`heap ${formatWord(layout.heapBaseAddress)}`,
			`$sp ${formatWord(layout.stackPointer)}`,
		]
	},
})

/**
 * The program arguments field is one line of text.  Words are separated by
 * whitespace, and quoting keeps one that has spaces in it together.
 */
export function splitProgramArguments(text: string): string[] {
	return [...text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
		.map((match) => match[1] ?? match[2] ?? match[3])
}
