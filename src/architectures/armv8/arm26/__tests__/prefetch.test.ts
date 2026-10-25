import { describe, expect, it } from 'vitest'
import { Arm26BusClock, READ_EXTERNAL, READ_FILL, READ_HIT } from '../busTiming'
import { Arm26Cpu, FAULT_PREFETCH_ABORT, STEP_FAULT, STEP_HALT, STEP_OK } from '../cpu'
import { assembleArm26 } from '../assemble'
import { Arm26Machine } from '../machine'
import type { Arm26Model } from '../arm3'
import definition from '../index'
import { DEFAULT_ARM26_SETTINGS } from '../settings'

function boot(code: string, cpuModel: Arm26Model = 'arm2', sequential = 1, latency = 1) {
	const { image, diagnostics } = assembleArm26({ name: 'test.s', code }, { cpuModel })
	expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const machine = new Arm26Machine({ memoryBytes: 1 << 20, cpuModel, timing: { sequential, latency }, historyLimit: 100 })
	machine.load(image!)
	return machine
}

describe('ARM26 bus-clock timing', () => {
	it('uses separate sequential, non-sequential and internal memory costs', () => {
		const clock = new Arm26BusClock({ sequential: 3, latency: 2 })
		clock.read(0x100, false, READ_EXTERNAL, false)
		expect(clock.ticks).toBe(5)
		clock.read(0x104, true, READ_EXTERNAL, false)
		expect(clock.ticks).toBe(8)
		clock.internal(false)
		expect(clock.ticks).toBe(10)
		clock.write(false, false)
		expect(clock.ticks).toBe(15)
		clock.write(true, false)
		expect(clock.ticks).toBe(18)
	})

	it('reproduces the VLSI pp. 3-65/66 worked example: 4F + 9L + 18A = 31 ticks', () => {
		// The manual assumes each line fetch replaces the previous line. Forced
		// misses reproduce that cache-state assumption independently of replacement.
		const clock = new Arm26BusClock()
		clock.read(0x1000, false, READ_FILL, true)
		clock.read(0x1004, true, READ_HIT, true)
		clock.read(0x1008, true, READ_HIT, true)
		clock.read(0x100C, true, READ_HIT, true)
		clock.read(0x1010, true, READ_FILL, true)
		clock.read(0x2004, false, READ_FILL, true)
		clock.internal(true)
		clock.read(0x1014, false, READ_FILL, true)
		clock.read(0x3000, false, READ_EXTERNAL, true)
		clock.read(0x3004, true, READ_EXTERNAL, true)
		clock.internal(true)
		expect(clock.ticks).toBe(31)
	})

	it('restarts at the critical word and absorbs internal cycles during the remaining fill', () => {
		const clock = new Arm26BusClock({ sequential: 3, latency: 2 })
		clock.read(0x1004, false, READ_FILL, true)
		// Synchronize 1+2L, then N, then the second word's A transfer.
		expect(clock.ticks).toBe(13)
		clock.internal(true)
		expect(clock.ticks).toBe(16)
		clock.read(0x100C, true, READ_HIT, true)
		expect(clock.ticks).toBe(19)
		clock.read(0x1000, false, READ_HIT, true)
		expect(clock.ticks).toBe(20)
	})

	it('keeps monitor-mode cache accesses on the memory clock', () => {
		const clock = new Arm26BusClock({ sequential: 3, latency: 3 })
		clock.read(0x1000, true, READ_HIT, true, true)
		expect(clock.ticks).toBe(3)
		clock.internal(true, true)
		expect(clock.ticks).toBe(6)
	})

	it('includes cold pipeline fill and the actual non-sequential fetch after a load', () => {
		const machine = boot('ldr r0,[r1]\nmov r2,#7\nswi OS_Exit', 'arm3', 3, 2)
		// Cold N+S = 8. LDR's prefetch S, data N and I add 3+5+2.
		machine.step()
		expect(machine.cpu.cycles).toBe(18)
		expect(machine.cpu.executeCycles).toBe(10)
		machine.step()
		expect(machine.cpu.executeCycles).toBe(5)
		expect(machine.cpu.cycles).toBe(23)
	})

	it('retains long clock durations without byte truncation', () => {
		const machine = boot('ldmia r0,{r1-r12}\nswi OS_Exit', 'arm3', 64, 64)
		machine.step()
		expect(machine.cpu.executeCycles).toBe(960)
		expect(machine.history!.executeCyclesAt(0)).toBe(960)
	})
})

describe('ARM26 speculative instruction prefetch', () => {
	it('keeps the queued instruction consistent with the PC held on a halting host SWI', () => {
		const machine = boot('mov r0,#7\nswi OS_Exit')
		expect(machine.run(10)).toBe(STEP_HALT)
		expect(machine.cpu.pc).toBe(0x8004)
		expect(machine.cpu.peekInstruction()).toBe(machine.cpu.instruction)
	})

	it.each(['arm2', 'arm3'] as const)('keeps the two prefetched words stale after a %s store', (model) => {
		for (const distance of [1, 2, 3]) {
			const padding = 'mov r3,#0\n'.repeat(distance - 1)
			const machine = boot(`ldr r0,=0xE3A01002\nadr r2,target\nstr r0,[r2]\n${padding}target: mov r1,#1\nswi OS_Exit`, model)
			if (machine.cpu.cache) {
				machine.cpu.cache.writeRegister(3, 1)
				machine.cpu.cache.writeRegister(4, 1)
				machine.cpu.cache.writeRegister(2, 3)
			}
			expect(machine.run(30)).toBe(STEP_HALT)
			expect(machine.cpu.register(1), `${model}, distance ${distance}`).toBe(distance <= 2 ? 1 : 2)
		}
	})

	it('refetches modified code after a taken branch', () => {
		const machine = boot('ldr r0,=0xE3A01002\nadr r2,target\nstr r0,[r2]\nb target\ntarget: mov r1,#1\nswi OS_Exit')
		expect(machine.run(30)).toBe(STEP_HALT)
		expect(machine.cpu.register(1)).toBe(2)
	})

	it('warms the ARM3 cache with the PC+8 fetch discarded by a branch', () => {
		const cpu = new Arm26Cpu(1 << 20)
		cpu.pc = 0x8008
		cpu.writeWord(0x8008, 0xEA0003FC) // B 0x9000
		cpu.writeWord(0x8010, 0xE3A00055)
		cpu.cache!.writeRegister(3, 1)
		cpu.cache!.writeRegister(2, 3)
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.pc).toBe(0x9000)
		expect(cpu.register(0)).toBe(0)
		cpu.writeWord(0x8010, 0xE3A00099)
		expect(cpu.cache!.peekWord(0x8010, false) >>> 0).toBe(0xE3A00055)
	})

	it('defers speculative prefetch aborts and discards them after a taken branch', () => {
		const cpu = new Arm26Cpu(256, 'arm2')
		cpu.pc = 252
		cpu.writeWord(252, 0xEAFFFFDF) // B 0x80; PC+4 and PC+8 are outside RAM.
		cpu.writeWord(128, 0xE3A00007)
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.pc).toBe(128)
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.register(0)).toBe(7)
	})

	it('raises a deferred abort when that queued instruction reaches execute', () => {
		const cpu = new Arm26Cpu(256, 'arm2')
		cpu.pc = 252
		cpu.writeWord(252, 0xE3A00007)
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.register(0)).toBe(7)
		expect(cpu.step()).toBe(STEP_FAULT)
		expect(cpu.fault).toBe(FAULT_PREFETCH_ABORT)
		expect(cpu.faultAddress).toBe(256)
	})

	it('does not invalidate already-prefetched instructions when CP15 flushes the cache', () => {
		const cpu = new Arm26Cpu(1 << 20)
		cpu.pc = 0x8000
		cpu.writeWord(0x8000, 0xEE010F10) // MCR p15,0,r0,c1,c0
		cpu.writeWord(0x8004, 0xE3A01001)
		cpu.cache!.writeRegister(3, 1)
		cpu.cache!.writeRegister(2, 3)
		cpu.step()
		cpu.writeWord(0x8004, 0xE3A01002)
		cpu.step()
		expect(cpu.register(1)).toBe(1)
	})

	it('rewinds debugger invalidation back to the original queued instruction and clock state', () => {
		const machine = boot('mov r0,#0\nmov r1,#1\nswi OS_Exit')
		machine.step()
		const before = { words: machine.cpu.prefetch.words.slice(), times: machine.cpu.prefetch.times.slice(), clock: machine.cpu.clock.state.slice() }
		machine.editBytes(0x8004, [2, 16, 160, 227]) // MOV r1,#2
		machine.step()
		expect(machine.cpu.register(1)).toBe(2)
		machine.history!.stepBack()
		machine.history!.stepBack()
		expect(machine.cpu.prefetch.words).toEqual(before.words)
		expect(machine.cpu.prefetch.times).toEqual(before.times)
		expect(machine.cpu.clock.state).toEqual(before.clock)
		machine.step()
		expect(machine.cpu.register(1)).toBe(1)
	})

	it('steps over the queued call even when RAM already contains its replacement', async () => {
		const services = definition.createServices()
		try {
			const code = 'ldr r0,=0xE1A00000\nadr r2,call\nstr r0,[r2]\ncall: bl subroutine\nswi OS_Exit\nsubroutine: mov r1,#7\nmov pc,lr'
			const program = services.assemble({ files: [{ name: 'test.s', code }], entries: ['test.s'] }, DEFAULT_ARM26_SETTINGS)
			expect(program.diagnostics).toEqual([])
			const runtime = services.createMachine(program, DEFAULT_ARM26_SETTINGS, { historyLimit: 100, speed: null })
			for (let step = 0; step < 3; step++) runtime.step()
			await runtime.stepOver()
			expect(runtime.registerValues().PC).toBe(0x8010)
			expect(runtime.registerValues().R1).toBe(7)
		} finally {
			services.dispose()
		}
	})
})
