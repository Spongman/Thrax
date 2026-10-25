import { describe, expect, it } from 'vitest'
import { cpuHistorySchema, createConfiguredArchitecture, type CpuConfiguration } from '../configuredCpu'
import { ConfiguredRuntime } from '../configuredRuntime'

function fixture(overrides: Partial<CpuConfiguration> = {}) {
	const config: CpuConfiguration = {
		id: 'fixture', name: 'Fixture', language: 'fixture', reference: 'https://example.com/fixture',
		registers: [{ id: 'r0', name: 'R0', bits: 32, bank: 'cpu', editable: true }, { id: 'r1', name: 'R1', bits: 32, bank: 'cpu', editable: true }],
		pcBits: 16, memoryBytes: 256, textBase: 0, dataBase: 128, wordBytes: 1, instructionAlignment: 1, littleEndian: true,
		historySchema: cpuHistorySchema({ registers: 2, wide: false, instructionBytes: 2 }),
		examples: {}, instructions: ['load', 'store', 'input', 'print', 'halt'],
		instructionHelp: Object.fromEntries(['load', 'store', 'input', 'print', 'halt'].map(name => [name, { syntax: name, description: `Fixture ${name} operation.` }])),
		instructionSize: name => name === 'load' || name === 'store' ? 2 : 1,
		encode: (name, args, context) => {
			const op = ['halt', 'load', 'store', 'input', 'print'].indexOf(name)
			if (op < 0) throw new Error('Unknown fixture instruction')
			return op === 1 || op === 2 ? [op, context.value(args[0])] : [op]
		},
		decode: (memory, address) => {
			const op = memory[address], value = memory[address + 1]
			return { size: op === 1 || op === 2 ? 2 : 1, text: `${op}:${value}`, execute: cpu => {
				if (op === 0) cpu.halt()
				else if (op === 1) cpu.r[0] = value
				else if (op === 2) cpu.write(128 + value, cpu.r[0])
				else if (op === 3) cpu.r[0] = cpu.inputInteger()
				else if (op === 4) cpu.output(String(cpu.r[0] | 0))
				else throw new Error('Illegal fixture instruction')
			} }
		},
		reset: cpu => { cpu.r[1] = 123 },
		...overrides,
	}
	const definition = createConfiguredArchitecture(config), services = definition.createServices()
	const load = (code: string) => {
		const program = services.assemble({ files: [{ name: 'test.asm', code }], entries: ['test.asm'] }, {})
		expect(program.diagnostics).toEqual([])
		return services.createMachine(program, {}, { speed: null, historyLimit: 100 })
	}
	return { definition, services, load }
}

describe('configured CPU workbench adapter', () => {
	it('caches accurate reset metadata and preserves future rows until an edit', () => {
		const f = fixture()
		try {
			expect(f.services.profile({}).resetRegisters.r1).toBe(123)
			expect(f.services.profile({})).toBe(f.services.profile({}))
			const machine = f.load('load 7\nstore 0\nhalt')
			machine.step(); machine.step(); machine.step()
			const ids = machine.history.slice(0, machine.history.length).map(row => row.id)
			expect(machine.stopReason?.kind).toBe('halt')
			expect(machine.stepBack()).toBe(true)
			machine.step()
			expect(machine.history.slice(0, machine.history.length).map(row => row.id)).toEqual(ids)
			machine.stepBack(); machine.stepBack()
			expect(machine.inspectMemory().byte(128)).toBe(0)
			machine.step()
			expect(machine.inspectMemory().byte(128)).toBe(7)
			machine.stepBack()
			machine.writeRegister('r0', 9)
			expect(machine.history.length).toBe(2)
			expect(machine.history.retention!.allocatedBufferBytes).toBeGreaterThan(0)
		} finally { f.services.dispose() }
	})
	it('replays accepted input without asking again and rejects malformed input without rows', async () => {
		const f = fixture()
		try {
			const machine = f.load('input\nprint\nhalt')
			await machine.run()
			expect(machine.pendingInput?.type).toBe('integer')
			expect(machine.instructionCount).toBe(0)
			expect(machine.provideInput('12x')).toBe(false)
			expect(machine.history.length).toBe(0)
			expect(machine.provideInput('-17')).toBe(true)
			await machine.continue()
			expect(machine.console).toBe('-17')
			const first = machine.history.at(0)!
			machine.rewindTo(first.id)
			await machine.continue()
			expect(machine.console).toBe('-17')
			expect(machine.pendingInput).toBeNull()
		} finally { f.services.dispose() }
	})
	it('shares register-byte aliases, holes and atomic shift boundaries', () => {
		const f = fixture({ memoryAliases: [{ address: 240, register: 0, bytes: 1 }], memoryRegion: address => address < 192 ? { start: 0, end: 191 } : address >= 240 ? { start: 240, end: 255 } : null })
		try {
			const machine = f.load('halt')
			machine.writeRegister('r0', 42)
			expect(machine.inspectMemory().byte(240)).toBe(42)
			machine.writeByte(240, 17)
			expect(machine.registerValues().r0).toBe(17)
			machine.stepBack()
			expect(machine.inspectMemory().byte(240)).toBe(42)
			expect(machine.registerValues().r0).toBe(42)
			expect(machine.inspectMemory().byte(200)).toBeUndefined()
			expect(machine.writeByte(200, 1)).toBe(false)
			expect(machine.insertByte(191, 240, 1)).toBe(false)
		} finally { f.services.dispose() }
	})
	it('preserves exact 64-bit edits and effect values on either side of the cursor', () => {
		const f = fixture({ wideRegisters: true,
			registers: [{ id: 'r0', name: 'R0', bits: 64, bank: 'cpu', editable: true }, { id: 'r1', name: 'R1', bits: 64, bank: 'cpu', editable: true }],
			historySchema: cpuHistorySchema({ registers: 2, wide: true, instructionBytes: 2 }), reset: cpu => { cpu.w[1] = 0xffffffffffffffffn } })
		try {
			const machine = f.load('halt'), value = 0xfedcba9876543210n
			expect(f.services.profile({}).resetRegisters.r1).toBe(0xffffffffffffffffn)
			machine.writeRegister('r0', value)
			machine.writeRegister('r0', value + 1n)
			const rows = machine.history.slice(0, machine.history.length)
			expect(machine.historyFormat.effects(rows[1], true).find(effect => effect.register === 'r0')?.value).toBe(value)
			machine.rewindTo(rows[0].id)
			expect(machine.historyFormat.effects(rows[0], false).find(effect => effect.register === 'r0')?.value).toBe(value)
			machine.step(); machine.step()
			expect(machine.registerValues().r0).toBe(value + 1n)
		} finally { f.services.dispose() }
	})
	it('keeps failed native execution atomic and guards disposed machine edits', () => {
		const f = fixture()
		try {
			const machine = f.load('.byte 255')
			expect(() => machine.step()).toThrow('Illegal fixture instruction')
			expect(machine.pc).toBe(0)
			expect(machine.instructionCount).toBe(0)
			expect(machine.history.length).toBe(0)
			expect(machine.stopReason?.kind).toBe('fault')
			machine.dispose()
			expect(machine.writeRegister('r0', 1)).toBe(false)
			expect(machine.writeByte(128, 1)).toBe(false)
		} finally { f.services.dispose() }
	})

	it('does not invent virtual register changes when exchanging a RAM-backed register', () => {
		const f = fixture({
			readRegister: (cpu, index) => index === 0 ? cpu.memory[128] : cpu.r[index],
			writeRegister: (cpu, index, value) => { if (index === 0) cpu.write(128, Number(value)); else cpu.r[index] = Number(value) },
		})
		try {
			const machine = f.load('halt')
			machine.writeRegister('r0', 41)
			machine.step()
			const halt = machine.history.at(1)!
			expect(machine.stepBack()).toBe(true)
			expect(machine.registerValues().r0).toBe(41)
			expect(machine.historyFormat.effects(halt, false).filter(effect => effect.register === 'r0')).toEqual([])
			machine.step()
			expect(machine.registerValues().r0).toBe(41)
			expect(machine.historyFormat.effects(halt, true).filter(effect => effect.register === 'r0')).toEqual([])
		} finally { f.services.dispose() }
	})

	it('executes modified and generated code without growing a catalog for repeated encodings', () => {
		const f = fixture()
		try {
			const machine = f.load('load 1\nhalt')
			for (let i = 0; i < 1000; i++) { machine.setProgramCounter(0); machine.writeByte(1, i & 1); machine.step(); expect(machine.registerValues().r0).toBe(i & 1) }
			expect((machine as unknown as { instructions: Map<number, unknown> }).instructions.size).toBe(2)
			machine.writeByte(128, 1); machine.writeByte(129, 7); machine.setProgramCounter(128); machine.step()
			expect(machine.registerValues().r0).toBe(7)
			machine.setProgramCounter(128); machine.writeByte(129, 9); machine.step()
			expect(machine.registerValues().r0).toBe(9)
		} finally { f.services.dispose() }
	})

	it('accepting replacement input branches the future without leaking an answer to a later request', async () => {
		const f = fixture()
		try {
			const machine = f.load('input\nprint\ninput\nprint\nhalt')
			await machine.run(); machine.provideInput('-17'); await machine.continue(); machine.provideInput('5'); await machine.continue()
			machine.rewindTo(machine.history.at(0)!.id)
			expect(machine.provideInput('-18')).toBe(true)
			await machine.continue()
			expect(machine.console).toBe('-18')
			expect(machine.pendingInput?.type).toBe('integer')
			machine.provideInput('6'); await machine.continue()
			expect(machine.console).toBe('-186')
		} finally { f.services.dispose() }
	})

	it('rolls back an unretired oversized instruction even after the history budget drops its row', () => {
		const f = fixture({ memoryBytes: 65536, dataBase: 32768, decode: () => ({ size: 1, text: 'bulk-input', execute: cpu => {
			cpu.r[0] = 77
			for (let i = 0; i < 60000; i++) cpu.write(i, 0xaa)
			cpu.r[0] = cpu.inputInteger()
		} }) })
		try {
			const machine = f.load('input') as ConfiguredRuntime
			machine.history.log.byteLimit = 2 * (machine.history.log.entries.blockBytes + machine.history.log.effects.blockBytes)
			machine.step()
			expect(machine.pendingInput?.type).toBe('integer')
			expect(machine.pc).toBe(0)
			expect(machine.registerValues().r0).toBe(0)
			expect(machine.inspectMemory().byte(0)).toBe(3)
			expect(machine.inspectMemory().byte(40000)).toBe(0)
			expect(machine.instructionCount).toBe(0)
			expect(machine.history.length).toBe(0)
			expect(machine.history.retention!.oversizedEntries).toBeGreaterThan(0)
		} finally { f.services.dispose() }
	})

	it('journals internal words sparsely across repeated writes, edits and history replay', () => {
		const f = fixture({ stateWords: 1000,
			readRegister: (cpu, index) => index === 0 ? cpu.state[999] : cpu.r[index],
			writeRegister: (cpu, index, value) => { if (index === 0) cpu.writeState(999, Number(value)); else cpu.r[index] = Number(value) },
			decode: () => ({ size: 1, text: 'internal', execute: cpu => { cpu.writeState(999, 1); cpu.writeState(999, 257); cpu.writeState(999, 257); cpu.writeState(700, 0xaabbccdd) } }),
		})
		try {
			const machine = f.load('halt') as ConfiguredRuntime, memory: number[] = []
			machine.observers.push({ onMemoryRead: address => memory.push(address), onMemoryWrite: address => memory.push(address) })
			machine.step()
			expect(machine.state[999]).toBe(257); expect(machine.state[700]).toBe(0xaabbccdd)
			expect(machine.history.log.effectCount(0)).toBe(6) // Two single-byte changes and one four-byte change.
			const row = machine.history.at(0)!
			expect(machine.historyFormat.effects(row, true)).toEqual([expect.objectContaining({ register: 'r0', value: 0 })])
			machine.stepBack()
			expect(machine.state.every(value => value === 0)).toBe(true)
			expect(machine.historyFormat.effects(row, false)).toEqual([expect.objectContaining({ register: 'r0', value: 257 })])
			machine.step()
			expect(machine.state[999]).toBe(257); expect(machine.state[700]).toBe(0xaabbccdd)
			machine.writeRegister('r0', 0x12345678)
			expect(machine.state[999]).toBe(0x12345678)
			machine.stepBack(); expect(machine.state[999]).toBe(257)
			machine.step(); expect(machine.state[999]).toBe(0x12345678)
			expect(memory).toEqual([])
			expect(() => machine.writeState(1000, 1)).toThrow(/index/)
		} finally { f.services.dispose() }
	})

	it('rolls back hidden words and post-instruction changes when execution fails or waits for input', () => {
		for (const failure of ['fault', 'input', 'finish']) {
			const f = fixture({ stateWords: 2,
				decode: () => ({ size: 1, text: 'internal', execute: cpu => {
					cpu.writeState(0, 0xffffffff); cpu.writeState(0, 17)
					if (failure === 'input') cpu.inputInteger()
					if (failure === 'fault') throw new Error('Native fault')
				} }),
				afterInstruction: cpu => { cpu.writeState(1, 42); throw new Error('Finish fault') },
			})
			try {
				const machine = f.load('halt') as ConfiguredRuntime
				if (failure === 'input') machine.step()
				else expect(() => machine.step()).toThrow(/fault/)
				expect(machine.state).toEqual(new Uint32Array(2))
				expect(machine.pc).toBe(0); expect(machine.instructionCount).toBe(0); expect(machine.history.length).toBe(0)
			} finally { f.services.dispose() }
		}
	})

	it('preserves hidden-word rollback after overflowing the typed history budget', () => {
		const f = fixture({ stateWords: 16000, decode: () => ({ size: 1, text: 'bulk-internal', execute: cpu => {
			for (let i = 0; i < cpu.state.length; i++) cpu.writeState(i, 0xdeadbeef)
			cpu.inputInteger()
		} }) })
		try {
			const machine = f.load('input') as ConfiguredRuntime
			machine.history.log.byteLimit = 2 * (machine.history.log.entries.blockBytes + machine.history.log.effects.blockBytes)
			machine.step()
			expect(machine.pendingInput?.type).toBe('integer')
			expect(machine.state.every(value => value === 0)).toBe(true)
			expect(machine.history.length).toBe(0)
			expect(machine.history.retention!.oversizedEntries).toBeGreaterThan(0)
		} finally { f.services.dispose() }
	})
})
