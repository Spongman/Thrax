import { expect } from 'vitest'
import { assembleZ80 } from '../asm'
import { STEP_HALT, STEP_WAIT, Z80Machine } from '../machine'

/** Assembles `code`, failing the test on any diagnostic. */
export function assemble(code: string) {
	const { image, diagnostics, values } = assembleZ80({ name: 'test.z80', code })
	expect(diagnostics).toEqual([])
	return { image: image!, values }
}

/** A machine with `code` loaded. */
export function machineFor(code: string, historyLimit = 0) {
	const machine = new Z80Machine({ historyLimit })
	const { image, values } = assemble(code)
	machine.load(image)
	return { machine, values }
}

/**
 * Runs until the program ends, feeding `input` the first time it waits;
 * returns the last step's status.
 */
export function runToEnd(machine: Z80Machine, input = '', limit = 1_000_000): number {
	let status = 0
	for (let steps = 0; steps < limit; steps++) {
		status = machine.step()
		if (status === STEP_WAIT) {
			if (!input) break
			machine.console.feed(input)
			input = ''
			continue
		}
		if (status === STEP_HALT) break
	}
	return status
}

/** Runs `count` steps. */
export function steps(machine: Z80Machine, count: number) {
	for (let step = 0; step < count; step++) machine.step()
}
