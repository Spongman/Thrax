import { describe, expect, it } from 'vitest'
import type { Machine } from '../../contracts'
import { line, load, MODEL_50, program, run, S370 } from './helpers'

const code = (...lines: string[]) => lines.join('\n')
const registers = (machine: Machine) => machine.registerValues()
/** Run to the closing SVC 3; a program interruption throws. */
async function exec(body: string[], data: string[] = [], settings = MODEL_50) {
	const machine = await load(program(code(...body), code(...data)), settings)
	run(machine)
	expect(machine.halted).toBe(true)
	return machine
}
async function fault(body: string[], data: string[] = [], settings = MODEL_50): Promise<{ message: string, machine: Machine, before: Record<string, unknown> }> {
	const machine = await load(program(code(...body), code(...data)), settings)
	for (let i = 0; i < 1000; i++) {
		const before = registers(machine)
		try { machine.step() } catch (error) { return { message: (error as Error).message, machine, before } }
	}
	throw new Error('no fault')
}

describe('fixed-point arithmetic and condition codes', () => {
	it.each([
		['AR', 5, 7, 12, 2],
		['AR', 0x7fffffff, 1, 0x80000000, 3],
		['AR', -5, 5, 0, 0],
		['SR', 5, 7, -2 >>> 0, 1],
		['ALR', 0xffffffff, 1, 0, 2],
		['ALR', 0xffffffff, 2, 1, 3],
		['ALR', 1, 2, 3, 1],
		['SLR', 5, 5, 0, 2],
		['SLR', 5, 7, -2 >>> 0, 1],
		['SLR', 7, 5, 2, 3],
		['NR', 12, 10, 8, 1],
		['XR', 12, 12, 0, 0],
	] as const)('%s %i,%i = %i with CC %i', async (op, a, b, result, cc) => {
		const machine = await exec([line('L', '1,A'), line('L', '2,B'), line(op, '1,2')], [line('DC', `F'${a | 0}'`, 'A'), line('DC', `F'${b | 0}'`, 'B')])
		expect(registers(machine)).toMatchObject({ r1: result, cc })
	})

	it.each([['CR', -1, 1, 1], ['CLR', -1, 1, 2], ['CR', 3, 3, 0], ['CH', 2, 1, 2]] as const)('%s %i,%i sets CC %i', async (op, a, b, cc) => {
		const second = op === 'CH' ? '=H\'1\'' : '2'
		const machine = await exec([line('L', '1,A'), line('L', '2,B'), line(op, `1,${second}`)], [line('DC', `F'${a}'`, 'A'), line('DC', `F'${b}'`, 'B')])
		expect(registers(machine).cc).toBe(cc)
	})

	it('multiplies into and divides from an even/odd pair, truncating toward zero', async () => {
		const machine = await exec([
			line('L', '3,=F\'-100000\''), line('M', '2,=F\'300000\''),         // -3e10 in R2:R3
			line('L', '4,=F\'-7\''), line('SRDA', '4,32'), line('D', '4,=F\'2\''),  // -7 / 2
			line('LA', '7,6'), line('MH', '7,=H\'-3\''),
		])
		const r = registers(machine)
		expect([r.r2, r.r3]).toEqual([0xfffffff9, 0x03dc5400])                 // -30000000000 = FFFFFFF9 03DC5400
		expect([r.r4, r.r5]).toEqual([-1 >>> 0, -3 >>> 0])
		expect(r.r7).toBe(-18 >>> 0)
	})

	it('raises fixed-point overflow only when the program mask enables it, retiring nothing', async () => {
		const quiet = await exec([line('L', '1,=F\'2147483647\''), line('A', '1,=F\'1\'')])
		expect(registers(quiet)).toMatchObject({ r1: 0x80000000, cc: 3 })
		const { message, machine, before } = await fault([line('L', '2,=X\'08000000\''), line('SPM', '2'), line('L', '1,=F\'2147483647\''), line('A', '1,=F\'1\'')])
		expect(message).toBe('Program interruption 0008: fixed-point-overflow exception')
		expect(registers(machine)).toEqual(before)
		expect(before).toMatchObject({ pm: 8, r1: 0x7fffffff })
	})

	it('raises fixed-point divide and specification exceptions', async () => {
		expect((await fault([line('SR', '0,0'), line('LA', '1,1'), line('D', '0,=F\'0\'')])).message).toBe('Program interruption 0009: fixed-point-divide exception (divisor is zero)')
		expect((await fault([line('M', '1,=F\'2\'')])).message).toMatch(/^Program interruption 0006: specification exception \(odd register/)
		expect((await fault([line('L', '1,ODD')], [line('DS', 'H'), line('DC', "X'00000001'", 'ODD')])).message).toMatch(/0006: specification exception \(operand alignment/)
		const unaligned = await exec([line('L', '1,ODD')], [line('DS', 'H'), line('DC', "X'00000001'", 'ODD')], S370)
		expect(registers(unaligned).r1).toBe(1)
		expect((await fault([line('L', '1,=A(X\'FFFFF0\')'), line('L', '2,0(,1)')])).message).toMatch(/^Program interruption 0005: addressing exception/)
		expect((await fault([line('DC', "X'0000'")])).message).toBe('Program interruption 0001: operation exception (undefined opcode)')
	})

	it('shifts arithmetically with overflow and logically by the address', async () => {
		const machine = await exec([
			line('L', '1,=X\'40000001\''), line('SLA', '1,1'),
			line('LR', '2,1'), line('SPM', '2'),
			line('L', '3,=F\'-8\''), line('SRA', '3,2'),
			line('L', '4,=X\'80000001\''), line('SRL', '4,31'),
			line('LA', '5,3'), line('SLL', '4,0(5)'),
		])
		const r = registers(machine)
		expect(r.r1).toBe(0x00000002)
		expect([r.r3, r.r4, r.cc]).toEqual([-2 >>> 0, 8, 1])
	})

	it('tests under mask and handles LTR, LCR, LPR and LNR', async () => {
		const machine = await exec([
			line('TM', 'BYTE,X\'C0\''), line('BALR', '6,0'),
			line('TM', 'BYTE,X\'82\''), line('BALR', '7,0'),
			line('TM', 'BYTE,X\'3E\''), line('BALR', '8,0'),
			line('L', '1,=F\'-5\''), line('LPR', '2,1'), line('LNR', '3,2'), line('LCR', '4,3'), line('LTR', '5,1'),
		], [line('DC', "X'C1'", 'BYTE')])
		const r = registers(machine)
		expect([Number(r.r6) >>> 28 & 3, Number(r.r7) >>> 28 & 3, Number(r.r8) >>> 28 & 3]).toEqual([3, 1, 0])
		expect([r.r2, r.r3, r.r4, r.cc]).toEqual([5, -5 >>> 0, 5, 1])
	})
})

describe('branching and linkage', () => {
	it('links the BC-mode PSW right half: ILC, CC, program mask and address', async () => {
		const machine = await load(code(
			line('CSECT', '', 'T'),
			line('BALR', '12,0'),                 // 1000: ILC 1, CC 0
			line('USING', '*,12'),
			line('L', '2,=X\'25000000\''),        // CC 2, mask 5
			line('SPM', '2'),
			line('BAL', '14,SUB'),                // 1008: ILC 2, returns to 100C
			line('SVC', '3'),
			line('BR', '14', 'SUB'),
			line('LTORG'),
		))
		machine.step()
		expect(registers(machine).r12).toBe(0x40001002)
		for (let i = 0; i < 3; i++) machine.step()
		expect(registers(machine).r14).toBe((0x80000000 | 0x20000000 | 0x05000000 | 0x100c) >>> 0)
		expect(machine.callStack).toMatchObject([{ callAddress: 0x1008, returnAddress: 0x100c, targetAddress: 0x100e }])
		expect(registers(machine).psw).toBe(0x00050000_00000000n | BigInt(0x25000000 | 0x100e))
		machine.step()
		expect(machine.pc).toBe(0x100c)
		expect(machine.callStack).toEqual([])
	})

	it('counts with BCT and BXH, and branches on extended mnemonics', async () => {
		const machine = await exec([
			line('LA', '1,3'), line('SR', '2,2'),
			line('LA', '2,1(,2)', 'AGAIN'), line('BCT', '1,AGAIN'),
			line('LA', '4,10'), line('L', '6,=F\'-2\''), line('LA', '7,4'),
			line('BXH', '4,6,DOWN', 'DOWN'),        // 8 and 6 are high; 4 is not
			line('CR', '2,1'), line('BNE', 'SKIP'), line('LA', '8,1'), line('LA', '9,1', 'SKIP'),
		])
		expect(registers(machine)).toMatchObject({ r1: 0, r2: 3, r4: 4, r8: 0, r9: 1 })
	})

	it('executes an MVC with a run-time length through EX', async () => {
		const machine = await exec([line('LA', '1,4'), line('EX', '1,MOVE'), line('B', 'DONE'), line('MVC', 'TO(0),FROM', 'MOVE'), line('LA', '2,1', 'DONE')],
			[line('DC', "C'ABCDEFGH'", 'FROM'), line('DC', "CL8' '", 'TO')])
		const memory = machine.inspectMemory()
		const at = [...Array(8)].map((_, i) => memory.byte(Number(machineLabel(machine, 'TO')) + i))
		expect(at).toEqual([0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0x40, 0x40, 0x40])
	})
})

function machineLabel(machine: Machine, name: string): number {
	const program = (machine as unknown as { program: { labels: Map<string, number> } }).program
	return program.labels.get(name)!
}

describe('storage operations', () => {
	it('translates and tests, and moves with propagation', async () => {
		const machine = await exec([
			line('TRT', 'TEXT,TABLE'), line('BALR', '9,0'),
			line('MVI', 'FILL,C\'*\''), line('MVC', 'FILL+1(4),FILL'),
			line('TR', 'TEXT,LOWER'),
		], [
			line('DC', "C'AB C'", 'TEXT'), line('DC', 'CL5\' \'', 'FILL'),
			line('DC', "256X'00'", 'TABLE'), line('ORG', 'TABLE+C\' \''), line('DC', "X'FF'"), line('ORG'),
			line('DC', "256X'00'", 'LOWER'), line('ORG', 'LOWER+C\'A\''), line('DC', "C'abc'"), line('ORG'),
		])
		const r = registers(machine), memory = machine.inspectMemory()
		expect(Number(r.r1) & 0xffffff).toBe(machineLabel(machine, 'TEXT') + 2)
		expect(Number(r.r2) & 255).toBe(0xff)
		expect(Number(r.r9) >>> 28 & 3).toBe(1)
		expect([...Array(5)].map((_, i) => memory.byte(machineLabel(machine, 'FILL') + i))).toEqual(Array(5).fill(0x5c))
		expect([...Array(4)].map((_, i) => memory.byte(machineLabel(machine, 'TEXT') + i))).toEqual([0x81, 0x82, 0x00, 0x83])
	})

	it('runs the System/370 long moves and masked characters', async () => {
		const machine = await exec([
			line('LA', '2,TO'), line('LA', '3,8'), line('LA', '4,FROM'), line('L', '5,=X\'40000003\''), line('MVCL', '2,4'),
			line('BALR', '9,0'),
			line('SR', '6,6'), line('ICM', '6,5,FROM'), line('BALR', '10,0'),
			line('STCM', '6,3,OUT'), line('CLM', '6,2,FROM'),
		], [line('DC', "C'XYZ'", 'FROM'), line('DC', "XL8'00'", 'TO'), line('DC', "XL2'00'", 'OUT')], S370)
		const r = registers(machine), memory = machine.inspectMemory(), to = machineLabel(machine, 'TO')
		expect([...Array(8)].map((_, i) => memory.byte(to + i))).toEqual([0xe7, 0xe8, 0xe9, 0x40, 0x40, 0x40, 0x40, 0x40])
		expect(Number(r.r9) >>> 28 & 3).toBe(2)
		expect([r.r3, Number(r.r2), r.r5]).toEqual([0, to + 8, 0x40000000])
		expect(r.r6).toBe(0x00e700e8)
		expect(Number(r.r10) >>> 28 & 3).toBe(1)
		expect([memory.byte(machineLabel(machine, 'OUT')), memory.byte(machineLabel(machine, 'OUT') + 1)]).toEqual([0x00, 0xe8])
		expect(r.cc).toBe(1)
	})
})

describe('supervisor calls and history', () => {
	it('translates EBCDIC console output and reads integers', async () => {
		const machine = await load(program(code(
			line('LA', '1,MSG'), line('LA', '0,L\'MSG'), line('SVC', '203'),
			line('LA', '1,X\'15\''), line('SVC', '202'),
			line('SVC', '201'), line('SVC', '200'),
		), line('DC', "C'Prices: $5 {ok}'", 'MSG')))
		run(machine)
		expect(machine.pendingInput).toEqual({ type: 'integer' })
		expect(machine.provideInput('-42')).toBe(true)
		run(machine)
		expect(machine.console).toBe('Prices: $5 {ok}\n-42')
	})

	it('steps back over registers, PSW fields, storage and console', async () => {
		const machine = await load(program(code(line('MVI', 'BYTE,X\'AA\''), line('LA', '1,7'), line('LTR', '1,1'), line('SVC', '200')), line('DC', "X'00'", 'BYTE')))
		const snapshots = [registers(machine)]
		for (let i = 0; i < 5; i++) { machine.step(); snapshots.push(registers(machine)) }
		expect(machine.console).toBe('7')
		expect(snapshots[5]).toMatchObject({ r1: 7, cc: 2 })
		for (let i = 5; i > 0; i--) { expect(machine.stepBack()).toBe(true); expect(registers(machine)).toEqual(snapshots[i - 1]) }
		expect(machine.console).toBe('')
		expect(machine.inspectMemory().byte(machineLabel(machine, 'BYTE'))).toBe(0)
	})

	it('returns through R14 to the monitor exit and reports unsupported calls', async () => {
		const machine = await load(code(line('CSECT', '', 'T'), line('BR', '14')))
		expect(registers(machine)).toMatchObject({ r13: 0x0f00, r14: 0x0ffe, r15: 0x1000 })
		run(machine)
		expect(machine.halted).toBe(true)
		expect((await fault([line('SVC', '99')])).message).toBe('Unsupported THRAX supervisor call SVC 99')
	})
})
