/**
 * An ARM target variant behind the `executionState` setting: AArch64 (a64/),
 * AArch32 (a32/) and Cortex-M0 ARMv6-M Thumb (m0/), each with its own assembler,
 * CPU and machine. The persisted target id remains `armv8`.
 */

import type { AssembledProgram, AssemblySources, DebugInspection, Disassembly, Machine, MachineOptions, MachineProfile, TokenDescription } from '../contracts'
import type { Armv8Settings } from './settings'

export interface ExecutionState {
	id: string
	assemble(sources: AssemblySources, settings: Armv8Settings): AssembledProgram
	/** Only this state's own assemblies are accepted. */
	createMachine(program: AssembledProgram, settings: Armv8Settings, options: MachineOptions): Machine
	profile(settings: Armv8Settings): MachineProfile
	disassembly: Disassembly
	describeToken(text: string, column: number, state: DebugInspection, program: AssembledProgram | null): TokenDescription | null
	/** Symbol values of the selected inspection program. */
	values(program: AssembledProgram | null): ReadonlyMap<string, number> | null
}
