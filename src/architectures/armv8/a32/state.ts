/**
 * The AArch32 execution state: A32 in GNU as or armasm syntax, assembled by
 * the shared ARM library under its ARMv8 profile and run in User mode under
 * Linux EABI system calls, in the AArch64 state's memory layout.
 */

import type { AssemblySource } from '../../../core/assembly/sources'
import { assembleArm, type ArmAssemblyResult } from '../shared/assembler'
import { describeArmToken } from '../shared/editor/dataTips'
import { ARCH_V8 } from '../shared/a32/isa'
import { a32Disassembly, ArmAssembly } from '../shared/program'
import type { AssembledProgram } from '../../contracts'
import { DATA_BASE, memoryTop, TEXT_BASE } from '../a64/layout'
import type { ExecutionState } from '../executionState'
import { a32Profile } from './profile'
import { A32Runtime } from './runtime'

export const a32DisassemblyV8 = a32Disassembly(ARCH_V8)

/** One translation unit, laid out as the AArch64 state lays out its programs. */
export function assembleA32(main: AssemblySource, files: readonly AssemblySource[] = [], memoryBytes = 4 << 20, floatingPoint = true): ArmAssemblyResult {
	return assembleArm(main, { files, arch: ARCH_V8, textBase: TEXT_BASE, dataBase: DATA_BASE, addressLimit: memoryTop(memoryBytes), floatingPoint })
}

function a32Assembly(program: AssembledProgram): ArmAssembly {
	if (!(program instanceof ArmAssembly) || program.arch !== ARCH_V8) throw new Error('Not an AArch32 program')
	return program
}

/** A fresh backend per activation; inspection receives its program explicitly. */
export function createA32State(): ExecutionState {
	return {
		id: 'aarch32',
		// The entry file, with the rest reached by `.include`.
		assemble({ files, entries }, settings) {
			const main = files.find((file) => file.name === entries[0]) ?? files[0]
			const result = assembleA32(main, files, settings.memoryBytes, settings.floatingPoint !== false)
			const failed = result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
			const program = new ArmAssembly(main.name, failed ? null : result.image, result.diagnostics, result.values, result.dialect, ARCH_V8)
			return program
		},
		createMachine: (program, settings, options) => new A32Runtime(a32Assembly(program), {
			memoryBytes: settings.memoryBytes,
			historyLimit: options.historyLimit,
			speed: options.speed,
			floatingPoint: settings.floatingPoint !== false,
		}),
		profile: (settings) => a32Profile(settings.memoryBytes),
		disassembly: a32DisassemblyV8,
		describeToken: (text, column, inspection, program) => describeArmToken(text, column, inspection, { arch: ARCH_V8, value: (name) => (program as ArmAssembly | null)?.values.get(name) }),
		values: program => (program as ArmAssembly | null)?.values ?? null,
	}
}
