/** The AArch64 execution state: GNU as A64 assembled on the shared engine, run on the A64 CPU under Linux system calls. */

import type { AssembledProgram } from '../../contracts'
import { describeA64Token } from '../editor/dataTips'
import type { ExecutionState } from '../executionState'
import { assembleA64 } from './assembler'
import { memoryTop } from './layout'
import { A64Assembly, a64Disassembly } from './program'
import { a64Profile } from './profile'
import { A64Runtime } from './runtime'

function a64Assembly(program: AssembledProgram): A64Assembly {
	if (!(program instanceof A64Assembly)) throw new Error('Not an AArch64 program')
	return program
}

/** A fresh state per activation, holding the last program for data tips. */
export function createA64State(): ExecutionState {
	let latest: A64Assembly | null = null
	return {
		id: 'aarch64',
		// One translation unit: the entry file, with the rest reached by `.include`.
		assemble({ files, entries }, settings) {
			const main = files.find((file) => file.name === entries[0]) ?? files[0]
			const result = assembleA64(main, { files })
			const program = new A64Assembly(main.name, result.image, result.diagnostics, result.values)
			// Caught here rather than when the machine loads it, so it is marked like any other error.
			const top = memoryTop(settings.memoryBytes)
			if (result.image && program.end() > top) {
				result.diagnostics.push({ severity: 'error', file: main.name, message: `The program ends at 0x${program.end().toString(16)}, past the end of memory at 0x${top.toString(16)}` })
			}
			if (result.image) latest = program
			return program
		},
		createMachine: (program, settings, options) => new A64Runtime(a64Assembly(program), {
			memoryBytes: settings.memoryBytes,
			historyLimit: options.historyLimit,
			speed: options.speed,
		}),
		profile: (settings) => a64Profile(settings.memoryBytes),
		disassembly: a64Disassembly,
		describeToken: (text, column, inspection) => describeA64Token(text, column, inspection, { value: (name) => latest?.values.get(name) }),
		values: () => latest?.values ?? null,
	}
}
