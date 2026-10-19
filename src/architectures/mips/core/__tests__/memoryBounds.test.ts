import { mipsHistorySchema } from '../../history/schema'
import { describe, expect, it } from 'vitest'
import { assembleMips } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'
import { MipsSimulator } from '../simulator'

async function run(source: string, configure?: (simulator: MipsSimulator) => void) {
	const { program, machineCode, diagnostics } = assembleMips(source)
	expect(firstError(diagnostics)?.message).toBeUndefined()
	const simulator = new MipsSimulator(machineCode, program, undefined, { historySchema: mipsHistorySchema })
	configure?.(simulator)
	// A fault ends the run through the same path the workspace uses, which is
	// what turns it into a console message rather than a thrown error.
	await simulator.run()
	return simulator
}

describe('text is code, not data', () => {
	it('refuses a load from the text segment', async () => {
		// `lw` from the program's own first word.
		const simulator = await run('main:\tlui $t0, 0x0040\n\tlw $t1, 0($t0)\n')
		expect(simulator.console).toContain('Cannot read directly from text segment!')
		expect(simulator.halted).toBe(true)
	})

	it('refuses a store into it, as before', async () => {
		const simulator = await run('main:\tlui $t0, 0x0040\n\tsw $zero, 0($t0)\n')
		expect(simulator.console).toContain('Cannot write directly to text segment!')
	})

	it('allows both once self-modifying code is on', async () => {
		const simulator = await run('main:\tlui $t0, 0x0040\n\tlw $t1, 0($t0)\n\tsw $t1, 4($t0)\n', (machine) => {
			machine.selfModifyingCode = true
		})
		expect(simulator.console).toBe('')
		// The word it read is the `lui` it started with.
		expect(simulator.registers.$t1 >>> 0).toBe(0x3c080040)
	})
})

describe('an address outside every segment', () => {
	it('faults on a store rather than succeeding in silence', async () => {
		const simulator = await run('main:\tsw $zero, 0($zero)\n')
		expect(simulator.console).toContain('address out of range')
		expect(simulator.halted).toBe(true)
	})

	it('faults on a load rather than reading zero', async () => {
		const simulator = await run('main:\tlw $t0, 0($zero)\n')
		expect(simulator.console).toContain('address out of range')
	})

	it('leaves the data segment, the stack and the devices alone', async () => {
		const simulator = await run(`
	.data
value:	.word 0
	.text
main:	la $t0, value
	li $t1, 7
	sw $t1, 0($t0)
	lw $t2, 0($t0)
	sw $t1, -8($sp)
	lui $t3, 0xffff
	lb $t4, 0($t3)
`)
		expect(simulator.console).toBe('')
		expect(simulator.registers.$t2).toBe(7)
	})

	it('reports the faulting address in the exception registers', async () => {
		const simulator = await run(`
	.ktext 0x80000180
	li $v0, 10
	syscall
	.text
main:	lw $t0, 0($zero)
	nop
`)
		// vaddr holds the address that faulted, cause the load code.
		expect(simulator.cp0Registers[8] >>> 0).toBe(0)
		expect((simulator.cp0Registers[13] >> 2) & 0x1f).toBe(4)
	})
})
