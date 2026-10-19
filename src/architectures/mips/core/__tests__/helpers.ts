import { mipsHistorySchema } from '../../history/schema'
import { mipsInstructionSet } from '../../instructions'
import type { MachineConfig } from '../../../../core/observer'
import { assembleMips, type AssembleResult } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'
import { MipsSimulator } from '../simulator'

/**
 * Assembly reports its faults rather than throwing, so the tests turn the first
 * error back into an exception and keep their `toThrow` expectations.
 */
export function check(result: AssembleResult): AssembleResult {
	const error = firstError(result.diagnostics)
	if (error) throw new Error(error.message)
	return result
}

export function assemble(source: string): AssembleResult {
	return check(assembleMips(source))
}

/** Assembles `source` and returns its machine words as unsigned numbers. */
export function words(source: string): number[] {
	return assemble(source).machineCode.map((word) => word >>> 0)
}

/** What a tool is configured with on a MIPS machine: how to read its instructions, and anything else given. */
export function toolMachine(extra: Partial<MachineConfig> = {}): MachineConfig {
	return { delayedBranching: false, instructions: mipsInstructionSet, ...extra }
}

export function build(source: string): MipsSimulator {
	const { program, machineCode } = assemble(source)
	return new MipsSimulator(machineCode, program, undefined, { historySchema: mipsHistorySchema })
}

/** Assembles and runs `source` to completion. */
export async function run(source: string): Promise<MipsSimulator> {
	const simulator = build(source)
	await simulator.run()
	return simulator
}

/** Runs `source` and returns everything it printed. */
export async function output(source: string): Promise<string> {
	return (await run(source)).console
}

/** A program body followed by a clean exit. */
export function withExit(body: string): string {
	return `${body}\nli $v0, 10\nsyscall\n`
}

/** Builds `source` with delayed branching turned on. */
export function buildDelayed(source: string): MipsSimulator {
	const { program, machineCode } = check(assembleMips(source, undefined, { delayedBranching: true }))
	const simulator = new MipsSimulator(machineCode, program, undefined, { historySchema: mipsHistorySchema })
	simulator.delayedBranching = true
	return simulator
}

/** Runs `source` with delayed branching on. */
export async function runDelayed(source: string): Promise<MipsSimulator> {
	const simulator = buildDelayed(source)
	await simulator.run()
	return simulator
}
