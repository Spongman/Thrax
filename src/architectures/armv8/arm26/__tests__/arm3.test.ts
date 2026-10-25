import { describe, expect, it } from 'vitest'
import { FLAG_C, FLAG_Z } from '../../shared/a32/isa'
import { disassembleA32 } from '../../shared/a32/disassemble'
import { ARM3_ID, Arm3Cache, type Arm26Model } from '../arm3'
import { assembleArm26 } from '../assemble'
import { Arm26Cpu, FAULT_UNDEFINED, MODE_SVC, MODE_USR, STEP_FAULT, STEP_HALT, STEP_OK } from '../cpu'
import { ARM3_EXAMPLES } from '../examples'
import { Arm26Machine } from '../machine'
import { multiplyCycles } from '../timing'
import definition from '../index'
import { DEFAULT_ARM26_SETTINGS } from '../settings'
import { Arm26Runtime } from '../runtime'
import { formatRegister } from '../../../../core/format'

function boot(code: string, cpuModel: Arm26Model = 'arm3') {
	const { image, diagnostics } = assembleArm26({ name: 'test.s', code }, { cpuModel })
	expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const machine = new Arm26Machine({ memoryBytes: 1 << 20, cpuModel, historyLimit: 100 })
	machine.load(image!)
	return machine
}

function instruction(word: number, cpuModel: Arm26Model = 'arm3') {
	const cpu = new Arm26Cpu(1 << 20, cpuModel)
	cpu.pc = 0x8000
	cpu.writeWord(cpu.pc, word)
	return cpu
}

describe('ARM3 CP15', () => {
	it.each([
		['mrc p15, 0, r0, c0, c0, 0', 0xEE100F10],
		['mcr 15, 0, r0, cr2, cr0', 0xEE020F10],
		['mrcne cp15, 0, r3, c4, c0, 0', 0x1E143F10],
	] as const)('encodes and disassembles %s using independent words', (code, expected) => {
		const machine = boot(code)
		expect(machine.cpu.readWord(0x8000) >>> 0).toBe(expected)
		expect(disassembleA32(expected, 0x8000)).toMatch(/^m[rc]{2}(?:ne)? p15,/)
	})

	it('reads the VL86C020 revision-zero ID and masks reserved control bits', () => {
		const machine = boot('mrc p15,0,r1,c0,c0\nmvn r0,#0\nmcr p15,0,r0,c2,c0\nmrc p15,0,r2,c2,c0\nswi OS_Exit')
		machine.cpu.psr = MODE_SVC
		expect(machine.run(10)).toBe(STEP_HALT)
		expect(machine.cpu.register(1) >>> 0).toBe(ARM3_ID)
		expect(machine.cpu.register(2)).toBe(7)
	})

	it('copies MRC-to-PC results into NZCV without changing PC or mode', () => {
		const cpu = instruction(0xEE10FF10)
		cpu.psr = MODE_SVC | FLAG_C
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.psr).toBe(MODE_SVC | FLAG_Z)
		expect(cpu.pc).toBe(0x8004)
		expect(cpu.redirected).toBe(false)
	})

	it.each([0xEE100F10, 0xEE020F10, 0xEE110F10, 0xEE000F10, 0xEE160F10, 0xEE100E10, 0xEE100F11, 0xEE000F00, 0xEC100F00])(
		'rejects illegal or unprivileged transfers 0x%s through the undefined path', (word) => {
			const cpu = instruction(word)
			if (word === 0xEE100F10 || word === 0xEE020F10) cpu.psr = MODE_USR
			expect(cpu.step()).toBe(STEP_FAULT)
			expect(cpu.fault).toBe(FAULT_UNDEFINED)
			expect(cpu.pc).toBe(0x8000)
		})

	it('skips a privileged transfer whose condition fails', () => {
		const cpu = instruction(0x0E100F10)
		cpu.psr = MODE_USR
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.executeCycles).toBe(1)
		expect(cpu.passed).toBe(false)
	})

	it('rejects SWP and CP15 in ARM2 source and raw machine code', () => {
		for (const code of ['swp r0,r1,[r2]', 'mrc p15,0,r0,c0,c0']) {
			const result = assembleArm26({ name: 'test.s', code }, { cpuModel: 'arm2' })
			expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error' && diagnostic.message.includes('ARM3'))).toBe(true)
		}
		for (const word of [0xE1020091, 0xEE100F10]) {
			const cpu = instruction(word, 'arm2')
			expect(cpu.cache).toBeNull()
			expect(cpu.step()).toBe(STEP_FAULT)
		}
	})

	it('runs the cache example, including its console output, on ARM3', () => {
		const machine = boot(ARM3_EXAMPLES.cache.code)
		expect(machine.run(100)).toBe(STEP_HALT)
		expect(machine.os.output).toBe('5')
		expect(machine.cpu.register(4) >>> 0).toBe(ARM3_ID)
	})
})

function cacheFixture() {
	const memory = new DataView(new ArrayBuffer(1 << 20))
	const cache = new Arm3Cache(memory)
	cache.writeRegister(3, 1)
	cache.writeRegister(4, 1)
	cache.writeRegister(2, 3)
	return { memory, cache }
}

describe('ARM3 unified cache', () => {
	it('fills a complete 16-byte line and preserves data until updated or flushed', () => {
		const { memory, cache } = cacheFixture()
		memory.setInt32(0x100, 5, true)
		memory.setInt32(0x104, 6, true)
		expect(cache.readWord(0x100, false)).toBe(5)
		memory.setInt32(0x104, 9, true)
		expect(cache.readWord(0x104, false)).toBe(6)
		cache.writeRegister(1, 0)
		expect(cache.readWord(0x104, false)).toBe(9)
	})

	it('uses updateable and disruptive regions even with the cache disabled', () => {
		const { memory, cache } = cacheFixture()
		memory.setInt32(0x100, 5, true)
		cache.readWord(0x100, false)
		cache.writeRegister(2, 2)
		memory.setInt32(0x100, 9, true)
		cache.written(0x100, 9, 4, false)
		cache.writeRegister(2, 3)
		expect(cache.readWord(0x100, false)).toBe(9)
		cache.writeRegister(4, 0)
		memory.setInt32(0x100, 12, true)
		cache.written(0x100, 12, 4, false)
		expect(cache.readWord(0x100, false)).toBe(9)
		cache.writeRegister(5, 1)
		cache.writeRegister(2, 2)
		cache.written(0x100, 12, 4, false)
		cache.writeRegister(2, 3)
		expect(cache.readWord(0x100, false)).toBe(12)
	})

	it('separates user and supervisor cache tags unless sharing is enabled', () => {
		const { memory, cache } = cacheFixture()
		cache.writeRegister(2, 1)
		memory.setInt32(0x100, 5, true)
		cache.readWord(0x100, false)
		memory.setInt32(0x100, 9, true)
		expect(cache.readWord(0x100, true)).toBe(9)
		expect(cache.readWord(0x100, false)).toBe(5)
		cache.writeRegister(2, 3)
		expect(cache.readWord(0x100, true)).toBe(5)
	})

	it('bypasses non-cacheable areas and makes debugger peeks side-effect-free', () => {
		const { memory, cache } = cacheFixture()
		cache.writeRegister(3, 0)
		const before = cache.state.slice()
		expect(cache.peekWord(0x100, false)).toBe(0)
		expect(cache.readWord(0x100, false)).toBe(0)
		memory.setInt32(0x100, 5, true)
		expect(cache.readWord(0x100, false)).toBe(5)
		expect(cache.state).toEqual(before)
	})

	it('reads SWP from external memory and writes through to RAM and the cache', () => {
		const cpu = instruction(0xE1020091)
		cpu.cache!.writeRegister(3, 1)
		cpu.cache!.writeRegister(4, 1)
		cpu.cache!.writeRegister(2, 3)
		cpu.writeWord(0x100, 5)
		cpu.cache!.readWord(0x100, false)
		cpu.writeWord(0x100, 9)
		cpu.writeRegister(2, 0x100)
		cpu.writeRegister(1, 12)
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.register(0)).toBe(9)
		expect(cpu.readWord(0x100)).toBe(12)
		expect(cpu.cache!.readWord(0x100, false)).toBe(12)
	})

	it('merges a byte store into the cache without replacing adjacent cached bytes', () => {
		const { memory, cache } = cacheFixture()
		memory.setInt32(0x100, 0x12345678, true)
		cache.readWord(0x100, false)
		cache.written(0x101, 0xAB, 1, false)
		expect(cache.readWord(0x100, false) >>> 0).toBe(0x1234AB78)
	})

	it('fetches cached instructions until explicitly flushed', () => {
		const cpu = instruction(0xE3A00001)
		cpu.cache!.writeRegister(3, 1)
		cpu.cache!.writeRegister(2, 3)
		cpu.cache!.readWord(cpu.pc, false)
		cpu.writeWord(cpu.pc, 0xE3A00002)
		expect(cpu.peekInstruction() >>> 0).toBe(0xE3A00001)
		cpu.step()
		expect(cpu.register(0)).toBe(1)
		cpu.pc = 0x8000
		cpu.cache!.flush()
		cpu.step()
		expect(cpu.register(0)).toBe(2)
	})

	it('reinstates flushed cache data and replacement state on rewind', () => {
		const machine = boot('mcr p15,0,r0,c1,c0\nswi OS_Exit')
		const cpu = machine.cpu
		cpu.psr = MODE_SVC
		cpu.cache!.writeRegister(3, 1)
		cpu.cache!.writeRegister(2, 3)
		cpu.writeWord(0x100, 42)
		cpu.cache!.readWord(0x100, false)
		const before = cpu.cache!.state.slice()
		machine.step()
		expect(cpu.cycles).toBe(9)
		expect(machine.history!.stepBack()).toBe(true)
		expect(cpu.cache!.state).toEqual(before)
		expect(cpu.cache!.peekWord(0x100, false)).toBe(42)
	})

	it('rewinds cache fills, CP15 controls and core cycles with typed effects', () => {
		const machine = boot('ldr r0,[r1]\nmcr p15,0,r2,c2,c0\nswi OS_Exit')
		const cpu = machine.cpu
		cpu.psr = MODE_SVC
		cpu.writeRegister(1, 0x10000)
		cpu.writeWord(0x10000, 42)
		cpu.cache!.writeRegister(3, 1)
		cpu.cache!.writeRegister(2, 3)
		const before = cpu.cache!.state.slice()
		machine.step()
		expect(cpu.register(0)).toBe(42)
		expect(cpu.cycles).toBe(11)
		const loaded = cpu.cache!.state.slice()
		machine.step()
		expect(cpu.cache!.readRegister(2)).toBe(0)
		expect(machine.history!.stepBack()).toBe(true)
		expect(cpu.cache!.state).toEqual(loaded)
		expect(cpu.cycles).toBe(11)
		expect(machine.history!.stepBack()).toBe(true)
		expect(cpu.cache!.state).toEqual(before)
		expect(cpu.cycles).toBe(0)
		expect(cpu.register(0)).toBe(0)
	})
})

describe('early ARM multiply operation counts', () => {
	it.each([[0, 2], [1, 2], [2, 3], [7, 3], [8, 4], [31, 4], [32, 5], [0x1FFFFFFF, 16], [0x20000000, 17], [-1, 17]])(
		'charges Rs=%s exactly %s core cycles', (rs, cycles) => expect(multiplyCycles(rs)).toBe(cycles))

	it('exposes and rewinds core counts beyond 32 bits without truncating the shared register view', () => {
		const services = definition.createServices()
		const program = services.assemble({ files: [{ name: 'test.s', code: 'mov r0,#1' }], entries: ['test.s'] }, DEFAULT_ARM26_SETTINGS)
		const runtime = services.createMachine(program, DEFAULT_ARM26_SETTINGS, { historyLimit: 10, speed: null }) as Arm26Runtime
		runtime.machine.cpu.cycles = 0x100000000
		runtime.step()
		expect(runtime.registerValues().CYCLES).toBe(0x100000004n)
		expect(formatRegister(runtime.registerValues().CYCLES, 64)).toBe('0x0000000100000004')
		runtime.stepBack()
		expect(runtime.registerValues().CYCLES).toBe(0x100000000n)
		services.dispose()
	})
})
