import { describe, expect, it, vi } from 'vitest'
import { BetaMachine } from '../../architectures/beta/machine'
import type { HistoryRecord, MemoryInspector } from '../../architectures/contracts'
import { formatAddress, parseAddress, registerAddress } from '../format'
import { HistoryView, describeValueEffect } from '../historyView'
import { inspectInteger } from '../inspection'
import { parseIntegerInput, readCString } from '../console'
import { LinuxConsole } from '../environments/linuxConsole'

describe('shared debugger contracts', () => {
	it('rolls a failed native edit back and leaves capture usable for the next edit', () => {
		const machine = new BetaMachine({ historyLimit: 100 })
		const original = machine.cpu.setRegister.bind(machine.cpu)
		vi.spyOn(machine.cpu, 'setRegister').mockImplementationOnce((register, value) => {
			original(register, value)
			throw new Error('Write failed')
		})
		expect(() => machine.editRegister(1, 123)).toThrow('Write failed')
		expect(machine.cpu.registers[1]).toBe(0)
		expect(machine.history!.length).toBe(0)
		expect(machine.editRegister(1, 456)).toBe(true)
		expect(machine.history!.length).toBe(1)
		expect(machine.history!.stepBack()).toBe(true)
		expect(machine.cpu.registers[1]).toBe(0)
	})

	it('reads counts without building rows and follows live retention bounds', () => {
		const columns = { length: 3, firstId: 40, countAt: (index: number) => index * 2 }
		let built = 0
		class View extends HistoryView<typeof columns, HistoryRecord> {
			protected record(log: typeof columns, index: number): HistoryRecord {
				built++
				return { id: log.firstId + index, instructionCount: log.countAt(index), address: index * 4, kind: 'instruction' }
			}
		}
		const history = new View(columns)
		expect(history.instructionCountAt(2)).toBe(4)
		expect(built).toBe(0)
		expect(history.at(-1)).toBeUndefined()
		expect(history.at(0.5)).toBeUndefined()
		expect(history.slice(-5, 99).map(row => row.id)).toEqual([40, 41, 42])
		columns.firstId++
		columns.length--
		expect(history.indexOfId(40)).toBe(-1)
		expect(history.indexOfId(42)).toBe(1)
		expect(history.indexOfId(41.5)).toBe(-1)
	})

	it('presents past and retained future values with the same chip convention', () => {
		const parts = { subject: 'R1', value: 255 }
		expect(describeValueEffect(true, parts, 8).label).toBe('R1 → 0xFF')
		expect(describeValueEffect(false, parts, 8).label).toBe('R1 0xFF →')
	})
})

describe('exact workbench addresses', () => {
	it('keeps high bits and distinguishes address formatting from register wrapping', () => {
		expect(formatAddress(0x1_0000_0004)).toBe('0x100000004')
		expect(parseAddress('0x100000004')).toBe(0x1_0000_0004)
		expect(parseAddress(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER)
		for (const text of ['-1', '1.5', '0x20000000000000']) expect(parseAddress(text)).toBeNull()
		expect(registerAddress(-1)).toBe(0xffffffff)
		expect(registerAddress(0x1_0000_0004n)).toBe(0x1_0000_0004)
		expect(registerAddress(-1n)).toBeNull()
		expect(registerAddress(0xffff_ffff_ffff_ffffn)).toBeNull()
	})

	it.each([true, false])('inspects wide values with explicit byte order (%s)', littleEndian => {
		const base = 0x1_0000_0000
		const memory: MemoryInspector = { wordBytes: 1, littleEndian, word: () => { throw new Error('No word path') }, byte: address => address >= base && address < base + 8 ? address - base + 1 : undefined }
		expect(inspectInteger(memory, base, 8)).toBe(littleEndian ? 0x0807060504030201n : 0x0102030405060708n)
		expect(inspectInteger(memory, base + 1, 8)).toBeUndefined()
	})
})

describe('shared console environment', () => {
	it('keeps Linux descriptor, wait, fault and input-consumption behavior', () => {
		const console = new LinuxConsole(), bytes = new Uint8Array(8)
		const memory = { valid: (address: number, size: number) => address >= 0 && address + size <= bytes.length, byte: (address: number) => bytes[address], store: (address: number, value: number) => { bytes[address] = value } }
		expect(console.read(0, Number.MAX_SAFE_INTEGER, 0, memory)).toBe(0)
		expect(console.read(0, 99, 4, memory)).toBeNull()
		expect(console.waiting).toBe(true)
		console.feed('a\r')
		expect(console.read(1, 0, 2, memory)).toBe(-9)
		expect(console.read(0, 99, 2, memory)).toBe(-14)
		expect(console.inputIndex).toBe(0)
		expect(console.read(0, 2, 4, memory)).toBe(2)
		expect([...bytes.slice(2, 4)]).toEqual([97, 10])
		expect(console.waiting).toBe(false)
		expect(console.write(1, 2, 2, memory)).toBe(2)
		expect(console.output).toBe('a\n')
		console.initialBreak = console.programBreak = 4
		expect(console.brk(7, 6)).toBe(4)
		expect(console.brk(5, 6)).toBe(5)
	})

	it('parses guest-width integers strictly and bounds unterminated strings', () => {
		expect(parseIntegerInput(' -2147483648 ', 32)).toBe(-2147483648)
		for (const text of ['2147483648', '12x', '0x10', '1.5', '']) expect(parseIntegerInput(text, 32)).toBeNull()
		expect(readCString(10, 3, address => [65, 66, 0][address - 10])).toBe('AB')
		expect(() => readCString(10, 2, () => 65)).toThrow('Unterminated console string')
	})
})
