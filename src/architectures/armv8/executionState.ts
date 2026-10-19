/**
 * An ARMv8-A execution state: everything that differs between AArch64 and
 * AArch32, behind one interface the definition dispatches through by the
 * `executionState` setting: AArch64 (a64/) and AArch32 (a32/), each with its
 * own assembler, CPU and machine.
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
	describeToken(text: string, column: number, state: DebugInspection): TokenDescription | null
	/** Symbol values of the last program that assembled, for data tips. */
	values(): ReadonlyMap<string, number> | null
}
