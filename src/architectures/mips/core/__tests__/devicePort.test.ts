import { mipsHistorySchema } from '../../history/schema'
import { describe, expect, it } from 'vitest'
import { Kind } from '../effectKind'
import { assembleMips } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'
import { MipsSimulator } from '../simulator'
import type { DevicePort, ExecutionObserver } from '../../../../core/observer'

/** Polls a device word, so what the device answers reaches the program. */
const POLLING = `
main:	lui $t0, 0x1001
	lw $t1, 0($t0)
	lw $t2, 0($t0)
	li $v0, 10
	syscall
`

/** A device that answers the program by writing where the program reads. */
class Counter implements ExecutionObserver {
	private port: DevicePort | null = null
	count = 0
	reads = 0

	onConfigure(machine: { device?: DevicePort }) {
		this.port = machine.device ?? null
	}

	onMemoryRead(address: number) {
		if ((address >>> 0) !== 0x10010000) return
		this.reads += 1
		this.count += 1
		this.port?.write(0x10010000, this.count)
	}

	/** What the device can see of the machine, which a rule may depend on. */
	peek(address: number) {
		return this.port?.read(address) ?? 0
	}
}

function build() {
	const { program, machineCode, diagnostics } = assembleMips(POLLING)
	expect(firstError(diagnostics)?.message).toBeUndefined()
	const simulator = new MipsSimulator(machineCode, program, undefined, { historySchema: mipsHistorySchema })
	const device = new Counter()
	device.onConfigure({ device: simulator.devicePort() })
	simulator.observers.push(device)
	return { simulator, device }
}

describe('a memory-mapped device can answer the program', () => {
	it('lands what it wrote where the program next reads', () => {
		const { simulator, device } = build()
		while (!simulator.halted) simulator.step()

		expect(device.reads).toBe(2)
		// The first read saw nothing yet; the second saw what the first produced.
		expect(simulator.registers.$t1).toBe(0)
		expect(simulator.registers.$t2).toBe(1)
	})

	it('applies the write at an instruction boundary, as its own entry', () => {
		const { simulator } = build()
		simulator.step()
		simulator.step()

		// The `lw` is one entry; the device write becomes another before the next.
		simulator.step()
		const history = simulator.getExecutionHistory()
		const edits = [...history].filter((entry) => entry.kind === 'edit')
		expect(edits).toHaveLength(1)
		expect(simulator.effects.kindAt(edits[0].effectStart)).toBe(Kind.MEMORY)
	})

	it('rolls back with everything else', () => {
		const { simulator } = build()
		while (!simulator.halted) simulator.step()
		expect(simulator.memory.get(0x10010000 >>> 2)).toBe(2)

		while (simulator.stepBack()) { /* to the start */ }
		expect(simulator.memory.get(0x10010000 >>> 2)).toBeUndefined()
	})

	it('lets a device read the machine without the observers hearing it', () => {
		const { simulator, device } = build()
		simulator.step()
		const before = device.reads
		expect(device.peek(0x00400000)).toBe(0x3c081001)
		expect(device.reads).toBe(before)
	})
})
