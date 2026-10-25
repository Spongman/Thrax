import { describe, expect, it } from 'vitest'
import { BASE, EIS, load, reg, run, word } from './helpers'

const N = 8, Z = 4, V = 2, C = 1
const flags = (machine: Awaited<ReturnType<typeof load>>) => reg(machine, 'psw') & 15

// Condition codes follow Table 5-1 of the PDP-11 Architecture Handbook.
describe('PDP-11 integer semantics', () => {
	it.each([
		['MOV #77777, R0\nADD #1, R0', 0o100000, N | V],
		['MOV #177777, R0\nADD #1, R0', 0, Z | C],
		['MOV #1, R0\nSUB #2, R0', 0o177777, N | C],
		['MOV #100000, R0\nSUB #1, R0', 0o77777, V],
		['MOV #100000, R0\nNEG R0', 0o100000, N | V | C],
		['CLR R0\nNEG R0', 0, Z],
		['MOV #77777, R0\nINC R0', 0o100000, N | V],
		['MOV #100000, R0\nDEC R0', 0o77777, V],
		['CLR R0\nCOM R0', 0o177777, N | C],
		['SEC\nMOV #1, R0\nROR R0', 0o100000, N | C],
		['MOV #40000, R0\nASL R0', 0o100000, N | V],
		['MOV #100001, R0\nASR R0', 0o140000, N | C],
		['SEC\nMOV #177777, R0\nADC R0', 0, Z | C],
		['CLR R0\nSEC\nSBC R0', 0o177777, N | C],
		['MOV #201, R0\nSWAB R0', 0o100400, Z],
		['MOVB #200, R0', 0o177600, N],
		['SEN\nSXT R0', 0o177777, N],
		['MOV #12., R0\nMOV #10., R1\nXOR R1, R0', 6, 0],
	] as const)('%s', async (code, value, codes) => {
		const machine = run(await load(`${code}\nHALT`))
		expect(reg(machine, 'r0')).toBe(value)
		expect(flags(machine)).toBe(codes)
	})

	it('compares as src - dst with a borrow', async () => {
		expect(flags(run(await load('CMP #1, #2\nHALT')))).toBe(N | C)
		expect(flags(run(await load('CMP #2, #1\nHALT')))).toBe(0)
		expect(flags(run(await load('CMP #100000, #1\nHALT')))).toBe(V)
		expect(flags(run(await load('CMPB #377, #1\nHALT')))).toBe(N)
	})

	it('steps byte autoincrement by one except on SP and PC', async () => {
		const machine = run(await load('MOV #2000, R1\nMOVB (R1)+, R0\nCLR -(SP)\nMOV SP, R2\nTSTB (SP)+\nMOVB -(R1), R3\nHALT'))
		expect(reg(machine, 'r1')).toBe(0o2000)
		expect(reg(machine, 'sp') - reg(machine, 'r2')).toBe(2)
	})

	it('sign-extends MOVB into registers but not into memory', async () => {
		const machine = run(await load('MOV #177777, @#2000\nMOVB #200, @#2000\nMOVB #377, R0\nHALT'))
		expect(word(machine, 0o2000)).toBe(0o177600)
		expect(reg(machine, 'r0')).toBe(0o177777)
	})

	it('evaluates each addressing mode, including the PC modes', async () => {
		const machine = run(await load(`
	MOV	#T, R1
	MOV	(R1), R0		; mode 1: 1
	ADD	2(R1), R0		; mode 6: 2
	MOV	#P, R2
	ADD	@(R2)+, R0		; mode 3: T+4 holds 3
	ADD	@-(R2), R0		; mode 5: the same pointer, 3
	MOV	#T+6, R3
	ADD	-(R3), R0		; mode 4: 3
	MOV	#T, R4
	ADD	(R4)+, R0		; mode 2: 1
	ADD	@2(R2), R0		; mode 7: Q points at X, 100
	ADD	X, R0			; mode 6 on PC: 100
	ADD	@Y, R0			; mode 7 on PC: 100
	ADD	@#X, R0			; mode 3 on PC: 100
	ADD	#5, R0			; mode 2 on PC: 5
	HALT
T:	.WORD	1, 2, 3
P:	.WORD	T+4
Q:	.WORD	X
X:	.WORD	100
Y:	.WORD	X
`))
		expect(reg(machine, 'r0')).toBe(1 + 2 + 3 + 3 + 3 + 1 + 0o100 * 4 + 5)
		expect([reg(machine, 'r2'), reg(machine, 'r3'), reg(machine, 'r4')]).toEqual([machine.program.labels.get('P'), machine.program.labels.get('T')! + 4, machine.program.labels.get('T')! + 2])
	})

	it('multiplies, divides and shifts with the EIS', async () => {
		const machine = run(await load(`
	MOV	#-3, R0
	MUL	#1000., R0		; R0:R1 = -3000
	MOV	R0, R4
	MOV	R1, R5
	CLR	R2
	MOV	#7, R3
	DIV	#2, R2			; 3 rem 1
	HALT`))
		expect([reg(machine, 'r4'), reg(machine, 'r5')]).toEqual([0o177777, -3000 & 0xffff])
		expect([reg(machine, 'r2'), reg(machine, 'r3')]).toEqual([3, 1])
		const negative = run(await load('MOV #177777, R0\nMOV #-7, R1\nDIV #2, R0\nHALT'))
		expect([reg(negative, 'r0'), reg(negative, 'r1'), flags(negative)]).toEqual([0o177775, 0o177777, N])
		const overflow = run(await load('MOV #1, R0\nCLR R1\nDIV #1, R0\nHALT'))
		expect([reg(overflow, 'r0'), reg(overflow, 'r1'), flags(overflow)]).toEqual([1, 0, V])
		const zero = run(await load('MOV #1, R0\nDIV #0, R0\nHALT'))
		expect(flags(zero) & (V | C)).toBe(V | C)
		const odd = run(await load('MOV #400, R1\nMUL #400, R1\nHALT'))
		expect([reg(odd, 'r1'), flags(odd)]).toEqual([0, C])
		const shifts = run(await load('MOV #1, R0\nASH #3, R0\nMOV #-1, R1\nASH #-1, R1\nCLR R2\nMOV #100000, R3\nASHC #1, R2\nHALT'))
		expect([reg(shifts, 'r0'), reg(shifts, 'r1'), reg(shifts, 'r2'), reg(shifts, 'r3')]).toEqual([0o10, 0o177777, 1, 0])
	})

	it('counts SOB loops and passes JSR R5 inline arguments', async () => {
		const machine = run(await load('MOV #3, R1\nCLR R0\nL: INC R0\nSOB R1, L\nJSR R5, S\n.WORD 5\nMOV R2, R3\nHALT\nS: MOV (R5)+, R2\nRTS R5'))
		expect([reg(machine, 'r0'), reg(machine, 'r1'), reg(machine, 'r3')]).toEqual([3, 0, 5])
	})

	it('runs the handbook MARK convention from the stack', async () => {
		const machine = run(await load(`
	MOV	#1234, R5
	MOV	R5, -(SP)
	MOV	#11, -(SP)
	MOV	#22, -(SP)
	MOV	#6402, -(SP)		; MARK 2
	MOV	SP, R5
	JSR	PC, S
	HALT
S:	RTS	R5`))
		expect(machine.halted).toBe(true)
		expect([reg(machine, 'r5'), reg(machine, 'sp')]).toEqual([0o1234, 0o160000])
	})

	it('reads the PSW and the console DL11 on the I/O page', async () => {
		const machine = run(await load('MOV #17, @#177776\nMOV @#177776, R0\nMOVB #101, @#177566\nTSTB @#177564\nMOV @#177776, R1\nHALT'))
		expect(reg(machine, 'r0')).toBe(0o17)
		expect(reg(machine, 'r1') & N).toBe(N)
		expect(machine.console).toBe('A')
	})
})

describe('PDP-11 traps', () => {
	it('enters a TRAP handler with PSW and PC stacked and returns with RTI', async () => {
		const machine = await load('MOV #H, @#34\nMOV #340, @#36\nSEC\nTRAP 5\nHALT\nH: MOV (SP), R0\nMOV 2(SP), R1\nMOV @#177776, R2\nRTI')
		run(machine)
		expect(reg(machine, 'r0')).toBe(machine.program.labels.get('H')! - 2)
		expect(reg(machine, 'r1') & C).toBe(C)
		expect(reg(machine, 'r2')).toBe(0o340)
		expect(reg(machine, 'psw')).toBe(C)
		expect(reg(machine, 'sp')).toBe(0o160000)
	})

	it('takes a trace trap after an instruction run with T set', async () => {
		const machine = run(await load('MOV #H, @#14\nMOV #20, @#177776\nINC R1\nHALT\nH: MOV 2(SP), R0\nHALT'))
		expect([reg(machine, 'r1'), reg(machine, 'r0'), reg(machine, 'psw') & 0o20]).toEqual([1, 0o20, 0])
	})

	it('traps instructions a model lacks to vector 10', async () => {
		const machine = await load('.WORD 070001', BASE)
		expect(() => machine.step()).toThrow(/Reserved instruction 070001 \(MUL requires the EIS.*vector 10/)
		const handled = run(await load('MOV #H, @#10\n.WORD 070001\nHALT\nH: MOV #7, R0\nHALT', BASE))
		expect(reg(handled, 'r0')).toBe(7)
		const eis = run(await load('MOV #3, R1\n.WORD 070101\nHALT', EIS))
		expect(reg(eis, 'r1')).toBe(9)
	})

	it('faults odd word addresses and absent devices through vector 4', async () => {
		const odd = await load('MOV #1001, R0\nMOV (R0), R1')
		odd.step()
		expect(() => odd.step()).toThrow(/Odd address 1001.*vector 4/)
		const absent = await load('TST @#177000')
		expect(() => absent.step()).toThrow(/bus timeout/)
		const caught = run(await load('MOV #H, @#4\nTST @#177000\nHALT\nH: MOV #1, R0\nHALT'))
		expect(reg(caught, 'r0')).toBe(1)
	})

	it('serves the THRAX monitor only while the EMT vector is empty', async () => {
		const monitor = run(await load('MOV #S, R0\nEMT 2\nMOV #-5, R0\nEMT 1\nHALT\nS: .ASCIZ /n=/'))
		expect(monitor.console).toBe('n=-5')
		const native = run(await load('MOV #H, @#30\nEMT 2\nHALT\nH: MOV #42, R3\nRTI'))
		expect([native.console, reg(native, 'r3')]).toEqual(['', 0o42])
		const unknown = await load('EMT 7')
		expect(() => unknown.step()).toThrow(/EMT 7 is not a THRAX monitor service/)
	})
})

describe('PDP-11 debugging', () => {
	it('steps back over output, registers and memory', async () => {
		const machine = await load('MOV #101, R0\nMOV R0, @#2000\nMOVB R0, @#177566\nHALT')
		machine.step(); machine.step()
		const before = machine.registerValues()
		machine.step()
		expect(machine.console).toBe('A')
		expect(machine.stepBack()).toBe(true)
		expect(machine.console).toBe('')
		expect(machine.registerValues()).toEqual(before)
		expect(machine.stepBack()).toBe(true)
		expect(word(machine, 0o2000)).toBe(0)
		machine.step(); machine.step()
		expect(machine.console).toBe('A')
	})

	it('steps over JSR and out with RTS', async () => {
		const machine = await load('JSR PC, S\nHALT\nS: INC R0\nINC R0\nRTS PC')
		await machine.stepOver()
		expect([machine.pc, reg(machine, 'r0'), machine.callStack.length]).toEqual([0o1004, 2, 0])
		const inner = await load('JSR PC, S\nHALT\nS: INC R0\nINC R0\nRTS PC')
		inner.step()
		expect(inner.callStack).toHaveLength(1)
		await inner.stepToReturn()
		expect([inner.pc, inner.callStack.length]).toEqual([0o1004, 0])
	})

	it('edits registers in their native widths', async () => {
		const machine = await load('HALT')
		expect(machine.writeRegister('psw', 0o177777)).toBe(true)
		expect(reg(machine, 'psw')).toBe(0o377)
		expect(machine.writeRegister('r3', 0o123456)).toBe(true)
		expect(reg(machine, 'r3')).toBe(0o123456)
	})
})
