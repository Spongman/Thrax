import { describe, expect, it } from 'vitest'
import { assembleA64 } from '../assembler'
import { FAULT_ADDRESS, FAULT_SYSCALL, FAULT_UNDEFINED, STEP_FAULT, STEP_HALT, STEP_WAIT } from '../cpu'
import { FLAG_C, FLAG_N, FLAG_V, FLAG_Z } from '../isa'
import { DATA_BASE, TEXT_BASE } from '../layout'
import { A64Machine } from '../machine'

const MEMORY = 1 << 20

function machineFor(code: string, historyLimit = 0): A64Machine {
	const result = assembleA64({ name: 'test.s', code })
	expect(result.diagnostics).toEqual([])
	const machine = new A64Machine({ memoryBytes: MEMORY, historyLimit })
	machine.load(result.image!)
	return machine
}

/** Runs `code` to its HLT and returns the machine. */
function run(code: string): A64Machine {
	const machine = machineFor(`${code}\n\t.text\n\thlt #0\n`)
	expect(machine.run(100_000)).toBe(STEP_HALT)
	return machine
}

const x = (machine: A64Machine, n: number) => machine.cpu.x[n]

describe('A64 CPU', () => {
	it('keeps 64-bit values exact', () => {
		const machine = run(`
	ldr x0, =0xFFFFFFFFFFFFFFFF
	add x1, x0, #1
	ldr x2, =0x123456789ABCDEF1
	add x3, x2, x2
	mov x4, #-2
	lsr x5, x0, #1
`)
		expect(x(machine, 0)).toBe(0xFFFF_FFFF_FFFF_FFFFn)
		expect(x(machine, 1)).toBe(0n)
		expect(x(machine, 3)).toBe(0x2468ACF13579BDE2n)
		expect(x(machine, 4)).toBe(0xFFFF_FFFF_FFFF_FFFEn)
		expect(x(machine, 5)).toBe(0x7FFF_FFFF_FFFF_FFFFn)
	})

	it('sets NZCV as AddWithCarry does', () => {
		const flags = (code: string) => run(code).cpu.nzcv
		expect(flags('\tmov x0, #1\n\tcmp x0, #1')).toBe(FLAG_Z | FLAG_C)
		expect(flags('\tmov x0, #1\n\tcmp x0, #2')).toBe(FLAG_N)
		expect(flags('\tmov x0, #-1\n\tadds x0, x0, #1')).toBe(FLAG_Z | FLAG_C)
		expect(flags('\tldr x0, =0x7FFFFFFFFFFFFFFF\n\tadds x0, x0, #1')).toBe(FLAG_N | FLAG_V)
		expect(flags('\tmov w0, #0x7FFFFFFF\n\tadds w0, w0, #1')).toBe(FLAG_N | FLAG_V)
		expect(flags('\tmov x0, #0\n\tsubs x0, x0, #1')).toBe(FLAG_N)
		expect(flags('\tmov x0, #0xF0\n\ttst x0, #0x0F')).toBe(FLAG_Z)
	})

	it('zero-extends W results into the X register', () => {
		const machine = run(`
	mov x0, #-1
	add w0, w0, #1
	mov x1, #-1
	mov w1, w1
	mov x2, #-1
	movk w2, #5
`)
		expect(x(machine, 0)).toBe(0n)
		expect(x(machine, 1)).toBe(0xFFFF_FFFFn)
		expect(x(machine, 2)).toBe(0xFFFF_0005n)
	})

	it('multiplies and divides at full width', () => {
		const machine = run(`
	mov x0, #-1
	mov x1, #-1
	umulh x2, x0, x1
	smulh x3, x0, x1
	mul x4, x0, x1
	mov w5, #-3
	mov w6, #7
	smull x7, w5, w6
	umull x8, w5, w6
	mov x9, #1
	lsl x9, x9, #63
	sdiv x10, x9, x0
	udiv x11, x9, xzr
	mov x12, #-7
	mov x13, #2
	sdiv x14, x12, x13
	msub x15, x14, x13, x12
`)
		expect(x(machine, 2)).toBe(0xFFFF_FFFF_FFFF_FFFEn)
		expect(x(machine, 3)).toBe(0n)
		expect(x(machine, 4)).toBe(1n)
		expect(x(machine, 7)).toBe(BigInt.asUintN(64, -21n))
		expect(x(machine, 8)).toBe(0xFFFF_FFFDn * 7n)
		// The most negative over -1 wraps to itself; division by zero gives zero.
		expect(x(machine, 10)).toBe(0x8000_0000_0000_0000n)
		expect(x(machine, 11)).toBe(0n)
		expect(x(machine, 14)).toBe(BigInt.asUintN(64, -3n))
		expect(x(machine, 15)).toBe(BigInt.asUintN(64, -1n))
	})

	it('runs the bitfield, shift and bit operations', () => {
		const machine = run(`
	ldr x0, =0xFEDCBA9876543210
	ubfx x1, x0, #4, #8
	sbfx x2, x0, #60, #4
	mov x3, #0
	bfi x3, x0, #8, #4
	asr x4, x0, #60
	ror x5, x0, #4
	clz x6, x1
	rbit w7, w0
	rev x8, x0
	sxtb x9, w0
	uxth w10, w0
	cls x11, x0
	mov x12, #5
	lsl x13, x0, x12
`)
		expect(x(machine, 1)).toBe(0x21n)
		expect(x(machine, 2)).toBe(0xFFFF_FFFF_FFFF_FFFFn)
		expect(x(machine, 3)).toBe(0x000n)
		expect(x(machine, 4)).toBe(0xFFFF_FFFF_FFFF_FFFFn)
		expect(x(machine, 5)).toBe(0x0FEDCBA987654321n)
		expect(x(machine, 6)).toBe(58n)
		expect(x(machine, 7)).toBe(0x084C2A6En)
		expect(x(machine, 8)).toBe(0x1032547698BADCFEn)
		expect(x(machine, 9)).toBe(0x10n)
		expect(x(machine, 10)).toBe(0x3210n)
		expect(x(machine, 11)).toBe(6n)
		expect(x(machine, 13)).toBe(0xDB97530ECA864200n)
	})

	it('selects and compares on conditions', () => {
		const machine = run(`
	mov x0, #3
	mov x1, #5
	cmp x0, x1
	csel x2, x0, x1, lt
	cset x3, gt
	cinc x4, x0, ne
	csneg x5, x0, x1, eq
	ccmp x0, #3, #0, lt
	cset x6, eq
	ccmp x0, #4, #4, gt
	cset x7, eq
`)
		expect(x(machine, 2)).toBe(3n)
		expect(x(machine, 3)).toBe(0n)
		expect(x(machine, 4)).toBe(4n)
		expect(x(machine, 5)).toBe(BigInt.asUintN(64, -5n))
		expect(x(machine, 6)).toBe(1n)
		// The condition fails, so NZCV takes #4: Z.
		expect(x(machine, 7)).toBe(1n)
	})

	it('loads and stores every width, with writeback', () => {
		const machine = run(`
	ldr x0, =buffer
	ldr x1, =0x8899AABBCCDDEEFF
	str x1, [x0]
	ldrb w2, [x0]
	ldrsb x3, [x0, #1]
	ldrh w4, [x0, #2]
	ldrsh w5, [x0, #6]
	ldrsw x6, [x0, #4]
	ldr w7, [x0, #4]
	strb w1, [x0, #8]!
	str x1, [x0], #8
	ldur x8, [x0, #-8]
	mov x9, #2
	ldrb w10, [x0, x9]
	ldr x11, [x0, x9, lsl #3]
	stp x1, x9, [sp, #-16]!
	ldp x12, x13, [sp], #16
	mov x14, sp
	.data
	.align 3
buffer:	.space 64
`)
		expect(x(machine, 2)).toBe(0xFFn)
		expect(x(machine, 3)).toBe(BigInt.asUintN(64, -0x12n))
		expect(x(machine, 4)).toBe(0xCCDDn)
		expect(x(machine, 5)).toBe(0xFFFF_8899n)
		expect(x(machine, 6)).toBe(0xFFFF_FFFF_8899_AABBn)
		expect(x(machine, 7)).toBe(0x8899_AABBn)
		expect(x(machine, 0)).toBe(BigInt(DATA_BASE + 16))
		expect(x(machine, 8)).toBe(0x8899AABBCCDDEEFFn)
		expect(x(machine, 10)).toBe(0n)
		expect(x(machine, 12)).toBe(0x8899AABBCCDDEEFFn)
		expect(x(machine, 13)).toBe(2n)
		expect(x(machine, 14)).toBe(BigInt(TEXT_BASE + MEMORY))
	})

	it('calls and returns, keeping a shadow call stack', () => {
		const machine = machineFor(`
_start:
	mov x0, #5
	bl double
	bl double
	hlt #0
double:
	add x0, x0, x0
	ret
`)
		machine.run(3)
		expect(machine.callStack.depth).toBe(1)
		expect(machine.callStack.frames()[0]).toMatchObject({ callSite: TEXT_BASE + 4, returnAddress: TEXT_BASE + 8, callee: TEXT_BASE + 16 })
		expect(machine.run(100)).toBe(STEP_HALT)
		expect(machine.callStack.depth).toBe(0)
		expect(x(machine, 0)).toBe(20n)
		expect(x(machine, 30)).toBe(BigInt(TEXT_BASE + 12))
	})

	it('branches on bits, zero and conditions', () => {
		const machine = run(`
	mov x0, #0
	mov x1, #0
	movk x1, #0x8000, lsl #48
loop:
	add x0, x0, #1
	cmp x0, #10
	b.lt loop
	tbnz x1, #63, set
	mov x2, #1
set:
	cbnz x2, never
	mov x3, #7
never:
`)
		expect(x(machine, 0)).toBe(10n)
		expect(x(machine, 2)).toBe(0n)
		expect(x(machine, 3)).toBe(7n)
	})

	it('writes to the console and exits through svc', () => {
		const machine = machineFor(`
_start:
	mov x0, #1
	ldr x1, =message
	mov x2, #6
	mov x8, #64
	svc #0
	mov x0, #3
	mov x8, #93
	svc #0
	.data
message: .ascii "hello\\n"
`)
		expect(machine.run(100)).toBe(STEP_HALT)
		expect(machine.linux.output).toBe('hello\n')
		expect(machine.linux.exitCode).toBe(3)
		expect(machine.halted).toBe(true)
	})

	it('waits in read until input arrives', () => {
		const machine = machineFor(`
	mov x0, #0
	ldr x1, =buffer
	mov x2, #16
	mov x8, #63
	svc #0
	hlt #0
	.data
buffer: .space 16
`)
		expect(machine.run(100)).toBe(STEP_WAIT)
		expect(machine.linux.waiting).toBe(true)
		machine.linux.feed('hi\n')
		expect(machine.run(100)).toBe(STEP_HALT)
		expect(x(machine, 0)).toBe(3n)
		expect([...machine.cpu.memory.subarray(DATA_BASE - TEXT_BASE, DATA_BASE - TEXT_BASE + 3)]).toEqual([104, 105, 10])
	})

	it('moves the program break with brk', () => {
		const machine = run(`
	mov x0, #0
	mov x8, #214
	svc #0
	mov x19, x0
	add x0, x0, #4096
	mov x8, #214
	svc #0
	mov x20, x0
	.data
	.word 1
`)
		expect(x(machine, 19)).toBe(BigInt(DATA_BASE + 16))
		expect(x(machine, 20)).toBe(BigInt(DATA_BASE + 16 + 4096))
	})

	it('faults without changing anything', () => {
		const outside = machineFor('\tmov x0, #8\n\tldr x1, [x0]\n')
		outside.run(10)
		expect(outside.cpu.fault).toBe(FAULT_ADDRESS)
		expect(outside.cpu.faultAddress).toBe(8)
		expect(outside.cpu.pc).toBe(TEXT_BASE + 4)
		const undefinedWord = machineFor('\t.inst 0\n')
		expect(undefinedWord.step()).toBe(STEP_FAULT)
		expect(undefinedWord.cpu.fault).toBe(FAULT_UNDEFINED)
		const syscall = machineFor('\tmov x8, #1000\n\tsvc #0\n')
		syscall.run(10)
		expect(syscall.cpu.fault).toBe(FAULT_SYSCALL)
		expect(syscall.cpu.faultDetail).toMatch(/1000/)
	})

	it('answers the keyboard and display registers', () => {
		const machine = machineFor(`
	mov x0, #0xFFFF0000
poll:
	ldr w1, [x0]
	cbz w1, poll
	ldr w2, [x0, #4]
	str w2, [x0, #12]
	hlt #0
`)
		machine.run(50)
		expect(machine.halted).toBe(false)
		machine.keyboard.queued = 'Q'
		expect(machine.run(50)).toBe(STEP_HALT)
		expect(machine.keyboard.display).toBe('Q')
	})

	it('rewinds every bit of registers, memory and flags', () => {
		const machine = machineFor(`
	ldr x0, =0x8000000000000001
	ldr x1, =slot
	str x0, [x1]
	adds x2, x0, x0
	sub sp, sp, #16
	hlt #0
	.data
slot: .quad 0x0123456789ABCDEF
`, 1000)
		const states: [bigint, bigint, bigint, number, bigint][] = []
		const snapshot = () => [x(machine, 0), x(machine, 2), machine.cpu.sp, machine.cpu.nzcv, new DataView(machine.cpu.memory.buffer).getBigUint64(DATA_BASE - TEXT_BASE, true)] as [bigint, bigint, bigint, number, bigint]
		while (!machine.halted) {
			states.push(snapshot())
			machine.step()
		}
		for (let index = states.length - 1; index >= 0; index--) {
			machine.history!.stepBack()
			expect(snapshot()).toEqual(states[index])
		}
		expect(machine.cpu.pc).toBe(TEXT_BASE)
	})
})
