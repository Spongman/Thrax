import { describe, expect, it } from 'vitest'
import { cpuHistorySchema, createConfiguredArchitecture } from '../configuredCpu'

describe('logical mixed-width registers over native columns', () => {
	it('keeps full-width values and history effects without widening the stored columns', () => {
		const descriptor = { id: 'pair', name: 'Pair', bits: 64, bank: 'cpu', editable: true }
		const definition = createConfiguredArchitecture({ id: 'packed', name: 'Packed', language: 'packed', reference: 'https://example.com',
			registers: ['lo', 'hi'].map(id => ({ ...descriptor, id, name: id, bits: 32 })),
			registerView: { registers: [descriptor], read: words => BigInt(words[0]) | BigInt(words[1]) << 32n, write(cpu, _index, value) { cpu.r[0] = Number(BigInt(value) & 0xffffffffn); cpu.r[1] = Number(BigInt(value) >> 32n) } },
			pcBits: 8, memoryBytes: 256, textBase: 0, dataBase: 128, wordBytes: 1, instructionAlignment: 1, littleEndian: true,
			historySchema: cpuHistorySchema({ registers: 2, wide: false, instructionBytes: 1 }), examples: {}, instructions: [], instructionHelp: {},
			instructionSize: () => 1, encode: () => [0], decode: () => ({ size: 1, text: 'put', execute(cpu) { cpu.r[0] = 1; cpu.r[1] = 2 } }),
		})
		const service = definition.createServices()
		try {
			const program = service.assemble({ files: [{ name: 'main.asm', code: 'put' }], entries: ['main.asm'] }, {})
			const cpu = service.createMachine(program, {}, { speed: null, historyLimit: 100 })
			expect(definition.registers.map(r => r.id)).toEqual(['pair', 'PC'])
			cpu.step(); expect(cpu.registerValues().pair).toBe(0x200000001n)
			const entry = cpu.history.at(0)!
			expect(cpu.historyFormat.effects(entry, true)).toContainEqual(expect.objectContaining({ register: 'pair', value: 0n }))
			cpu.stepBack(); expect(cpu.registerValues().pair).toBe(0n)
			cpu.step(); expect(cpu.registerValues().pair).toBe(0x200000001n)
			expect(cpu.writeRegister('pair', 0xffffffffffffffffn)).toBe(true)
			expect(cpu.registerValues().pair).toBe(0xffffffffffffffffn)
			cpu.stepBack(); expect(cpu.registerValues().pair).toBe(0x200000001n)
		} finally { service.dispose() }
	})
})
