import { describe, expect, it } from 'vitest'
import type { Machine } from '../../contracts'
import { line, load, MODEL_30, MODEL_50, program, run, S370 } from './helpers'

const labelOf = (machine: Machine, name: string) => (machine as unknown as { program: { labels: Map<string, number> } }).program.labels.get(name)!
const bytesAt = (machine: Machine, name: string, length: number) => {
	const at = labelOf(machine, name), memory = machine.inspectMemory()
	return Array.from({ length }, (_, i) => memory.byte(at + i)!.toString(16).toUpperCase().padStart(2, '0')).join('')
}
async function exec(body: string[], data: string[], settings = MODEL_50) {
	const machine = await load(program(body.join('\n'), data.join('\n')), settings)
	run(machine)
	expect(machine.halted).toBe(true)
	return machine
}

// Packed and zoned layouts and the ED pattern characters follow GA22-6821,
// "Decimal Arithmetic" and "Edit": digits, then sign C (plus) or D (minus).
describe('decimal instructions', () => {
	it('packs, unpacks and moves with offset', async () => {
		const machine = await exec([line('PACK', 'P,Z'), line('UNPK', 'U,P'), line('MVO', 'M,=X\'1234\'')],
			[line('DC', "Z'12345'", 'Z'), line('DS', 'PL3', 'P'), line('DS', 'ZL5', 'U'), line('DC', "X'00000F'", 'M')])
		expect([bytesAt(machine, 'P', 3), bytesAt(machine, 'U', 5), bytesAt(machine, 'M', 3)]).toEqual(['12345C', 'F1F2F3F4C5', '01234F'])
	})

	it.each([
		['AP', "PL2'999'", "P'1'", '000C', 3],
		['SP', "PL2'5'", "P'12'", '007D', 1],
		['ZAP', "PL3'0'", "P'-5'", '00005D', 1],
		['AP', "PL2'-5'", "P'5'", '000C', 0],
		['CP', "PL2'7'", "P'-7'", '007C', 2],
	] as const)('%s %s,%s = %s with CC %i', async (op, a, b, result, cc) => {
		const machine = await exec([line(op, 'A,B')], [line('DC', a, 'A'), line('DC', b, 'B')])
		expect(bytesAt(machine, 'A', result.length / 2)).toBe(result)
		expect(machine.registerValues().cc).toBe(cc)
	})

	it('multiplies and divides with algebraic signs', async () => {
		const machine = await exec([line('MP', 'A,=P\'-4\''), line('DP', 'B,=P\'-10\'')], [line('DC', "PL4'123'", 'A'), line('DC', "PL4'1234'", 'B')])
		expect([bytesAt(machine, 'A', 4), bytesAt(machine, 'B', 4)]).toEqual(['0000492D', '123D004C'])
	})

	it('edits with significance, fill and the trailing sign, and marks with EDMK', async () => {
		const machine = await exec([
			line('ED', 'OUT1,=P\'123456\''),
			line('MVC', 'OUT2,PATTERN2'), line('LA', '1,0'), line('EDMK', 'OUT2,=PL3\'-12\''), line('LR', '2,1'),
			line('EDMK', 'OUT3,=PL2\'12\''), line('LR', '3,1'),
		], [
			line('DC', "X'4020206B2021204B2020'", 'OUT1'),
			line('DC', "X'402020214B2020C3D9'", 'PATTERN2'), line('DS', 'CL9', 'OUT2'),
			line('DC', "X'40202020'", 'OUT3'),
		])
		expect(bytesAt(machine, 'OUT1', 10)).toBe('4040F16BF2F3F44BF5F6')                // "  1,234.56"
		expect(bytesAt(machine, 'OUT2', 9)).toBe('404040404BF1F2C3D9')                  // "    .12CR"
		expect(bytesAt(machine, 'OUT3', 4)).toBe('4040F1F2')                           // "  12"
		// A significance starter, not a digit, turned significance on: EDMK leaves R1 alone.
		expect(machine.registerValues().r2).toBe(0)
		expect(machine.registerValues().r3).toBe(labelOf(machine, 'OUT3') + 2)
		expect(machine.registerValues().cc).toBe(2)
	})

	it('converts between binary and packed doublewords', async () => {
		const machine = await exec([line('CVB', '1,DW'), line('LA', '2,1234'), line('CVD', '2,OUT')], [line('DC', "PL8'-1234'", 'DW'), line('DS', 'D', 'OUT')])
		expect(machine.registerValues().r1).toBe(-1234 >>> 0)
		expect(bytesAt(machine, 'OUT', 8)).toBe('000000000001234C')
	})

	it('shifts and rounds on System/370', async () => {
		const machine = await exec([line('SRP', 'A,64-1,5'), line('SRP', 'B,2,0')], [line('DC', "P'12345'", 'A'), line('DC', "PL3'1234'", 'B')], S370)
		expect([bytesAt(machine, 'A', 3), bytesAt(machine, 'B', 3)]).toEqual(['01235C', '23400C'])
		expect(machine.registerValues().cc).toBe(3)
	})

	it('raises data exceptions and gates the decimal feature at run time', async () => {
		const bad = await load(program(line('AP', 'A,A'), line('DC', "X'1A3C'", 'A')))
		expect(() => run(bad)).toThrow('Program interruption 0007: data exception (invalid decimal digit)')
		const absent = await load(program(`${line('DC', "X'FA11'")}\n${line('DC', "X'C010C010'")}`), MODEL_30)
		expect(() => run(absent)).toThrow('Program interruption 0001: operation exception (AP is not installed on this model)')
	})
})
