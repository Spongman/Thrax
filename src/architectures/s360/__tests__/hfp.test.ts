import { describe, expect, it } from 'vitest'
import type { Machine } from '../../contracts'
import { FLOAT_ENCODINGS, formatEncodedFloat } from '../../../core/floatEncodings'
import { assemble, imageBytes, line, load, MODEL_50, program, run, S370 } from './helpers'

const hex = (bytes: readonly number[]) => bytes.map(byte => byte.toString(16).toUpperCase().padStart(2, '0')).join('')
const f = (machine: Machine, n: number) => BigInt(machine.registerValues()[`f${n}`]).toString(16).toUpperCase().padStart(16, '0')

async function exec(body: string[], settings = MODEL_50, data: string[] = []) {
	const machine = await load(program(body.join('\n'), data.join('\n')), settings)
	run(machine)
	expect(machine.halted).toBe(true)
	return machine
}
async function fault(body: string[], settings = MODEL_50) {
	const machine = await load(program(body.join('\n')), settings)
	try { run(machine) } catch (error) { return (error as Error).message }
	throw new Error('no fault')
}

// Bit patterns are the hexadecimal floating-point format of GA22-6821:
// 1.0 = 0.1 (hex) x 16^1 = 41100000; E'0.1' rounds to 4019999A as HLASM does.
describe('hexadecimal floating-point constants', () => {
	it.each([
		["E'1'", '41100000'], ["E'0.5'", '40800000'], ["E'-1.5'", 'C1180000'], ["E'100'", '42640000'],
		["E'0.1'", '4019999A'], ["D'0.1'", '401999999999999A'], ["D'-2.0'", 'C120000000000000'],
		["E'0'", '00000000'], ["E'2.5E-1'", '40400000'],
		["L'1'", '41100000000000003300000000000000'],
	] as const)('%s = %s', async (constant, expected) => {
		const { program } = await assemble(`T        CSECT\n         DC    ${constant}`)
		expect(program.diagnostics).toEqual([])
		expect(hex(imageBytes(program, 0x1000, expected.length / 2))).toBe(expected)
	})
})

describe('hexadecimal floating-point arithmetic', () => {
	it.each([
		['AER', "E'1'", "E'1'", '41200000', 2],
		['AER', "E'0.5'", "E'0.5'", '41100000', 2],
		['SER', "E'1'", "E'3'", 'C1200000', 1],
		['SER', "E'1'", "E'1'", '00000000', 0],
		['MER', "E'2'", "E'3'", '41600000', -1],
		['DER', "E'1'", "E'3'", '40555555', -1],
		['MER', "E'0.1'", "E'0.1'", '3F28F5C3', -1],
		['AUR', "E'1'", "X'44000000'", '44000100', 2],
	] as const)('%s %s,%s = %s on System/360', async (op, a, b, expected, cc) => {
		const machine = await exec([line('LE', '0,A'), line('LE', '2,B'), line(op, '0,2')], MODEL_50, [line('DC', a, 'A'), line('DC', b, 'B')])
		expect(f(machine, 0).slice(0, 8)).toBe(expected)
		if (cc >= 0) expect(machine.registerValues().cc).toBe(cc)
	})

	it('keeps the low half on short operations and multiplies short to long on System/370', async () => {
		const body = [line('LD', '0,=D\'0.1\''), line('LE', '0,=E\'0.1\''), line('LE', '2,=E\'0.1\''), line('MER', '0,2')]
		expect(f(await exec([line('LD', '0,=D\'0.1\''), line('AE', '0,=E\'0\'')]), 0)).toBe('401999999999999A')
		expect(f(await exec(body), 0)).toBe('3F28F5C39999999A')
		expect(f(await exec(body, S370), 0)).toBe('3F28F5C3D70A4000')
	})

	it('halves without normalizing on System/360 and normalizes on System/370', async () => {
		expect(f(await exec([line('LE', '2,=E\'1\''), line('HER', '0,2')]), 0).slice(0, 8)).toBe('41080000')
		expect(f(await exec([line('LE', '2,=E\'1\''), line('HER', '0,2')], S370), 0).slice(0, 8)).toBe('40800000')
	})

	it('compares zeros of either sign equal and sets load-and-test codes', async () => {
		const machine = await exec([line('LE', '0,=X\'80000000\''), line('LE', '2,=X\'00000000\''), line('CER', '0,2'), line('BALR', '9,0'),
			line('LE', '4,=E\'-2\''), line('LPER', '6,4'), line('LNER', '2,6'), line('LCER', '0,2'), line('LTER', '4,4')])
		const r = machine.registerValues()
		expect(Number(r.r9) >>> 28 & 3).toBe(0)
		expect([f(machine, 6), f(machine, 2), f(machine, 0)].map(v => v.slice(0, 8))).toEqual(['41200000', 'C1200000', '41200000'])
		expect(r.cc).toBe(1)
	})

	it('converts with the unnormalized-add idiom and finds 0.1 + 0.2 = 0.3 in long precision', async () => {
		const machine = await exec([
			line('LD', '0,=D\'3142.857\''), line('AW', '0,MAGIC'),
			line('LD', '2,=D\'0.1\''), line('AD', '2,=D\'0.2\''), line('CD', '2,=D\'0.3\''),
		], MODEL_50, [line('DC', "0D,X'4E00000000000000'", 'MAGIC')])
		expect(f(machine, 0)).toBe('4E00000000000C46')
		expect(machine.registerValues().cc).toBe(0)
		expect(f(machine, 2)).toBe('404CCCCCCCCCCCCD')
	})

	it('raises exponent overflow, underflow, significance and divide exceptions only as masked', async () => {
		const big = line('LE', '0,=X\'7F100000\'')
		expect(await fault([big, line('ME', '0,=X\'7F100000\'')])).toBe('Program interruption 000C: exponent-overflow exception')
		expect(await fault([line('LE', '0,=E\'1\''), line('DE', '0,=E\'0\'')])).toBe('Program interruption 000F: floating-point-divide exception')
		const tiny = [line('LE', '0,=X\'00100000\''), line('ME', '0,=X\'00100000\'')]
		expect(f(await exec(tiny), 0).slice(0, 8)).toBe('00000000')
		expect(await fault([line('L', '1,=X\'02000000\''), line('SPM', '1'), ...tiny])).toBe('Program interruption 000D: exponent-underflow exception')
		expect(await fault([line('L', '1,=X\'01000000\''), line('SPM', '1'), line('LE', '0,=E\'1\''), line('SE', '0,=E\'1\'')])).toBe('Program interruption 000E: significance exception')
		expect(await fault([line('LER', '1,0')])).toMatch(/^Program interruption 0006: specification exception/)
	})
})

describe('register display', () => {
	it('reads and writes long HFP through the shared float encoding', () => {
		const ibm = FLOAT_ENCODINGS.ibm
		expect(formatEncodedFloat(ibm, 0, 0x41100000)).toBe('1')
		expect(formatEncodedFloat(ibm, 0x9999999a, 0x40199999)).toBe('0.1')
		expect(formatEncodedFloat(ibm, 0x41100000)).toBe('1')
		expect(ibm.encodeDouble(-2.5)).toEqual({ high: 0xc1280000, low: 0 })
		expect(ibm.encodeSingle(0.1)).toBe(0x4019999a)
	})
})

describe('workbench hooks', () => {
	it('describes F registers in HFP and publishes EBCDIC for the memory panel', async () => {
		const { services } = await assemble('T        CSECT')
		const tip = services.describeToken!('F0', 0, { registers: { f0: 0x4118000000000000n }, labels: new Map() } as never)
		expect(tip?.contents.join(' ')).toContain('**F0** = 0x4118000000000000 (1.5)')
		const characterSet = services.profile(MODEL_50).characterSet!
		expect([characterSet.name, characterSet.decode(0xc1), characterSet.encode(0x61)]).toEqual(['EBCDIC', 0x41, 0x81])
	})
})
