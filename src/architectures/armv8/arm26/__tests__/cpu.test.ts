import { describe, expect, it } from 'vitest'
import { FLAG_C, FLAG_N, FLAG_V, FLAG_Z } from '../../shared/a32/isa'
import { assembleArm26 } from '../assemble'
import {
	BANKS, FAULT_ADDRESS, FAULT_DATA_ABORT, FAULT_UNDEFINED, MODE_FIQ, MODE_IRQ, MODE_SVC, MODE_USR, PSR_F, PSR_I,
	STEP_EXCEPTION, STEP_FAULT, STEP_HALT, STEP_OK,
} from '../cpu'
import { Arm26Machine } from '../machine'

const MEMORY = 1 << 20

/** A machine with `code` loaded, assembled as GNU. */
function boot(code: string) {
	const { image, diagnostics } = assembleArm26({ name: 'test.s', code })
	expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const machine = new Arm26Machine({ memoryBytes: MEMORY, historyLimit: 1000 })
	machine.load(image!)
	return machine
}

/** Runs `code` to OS_Exit. */
function run(code: string) {
	const machine = boot(code)
	expect(machine.run(10_000)).toBe(STEP_HALT)
	return machine
}

const r = (machine: Arm26Machine, index: number) => machine.cpu.register(index)
const flags = (machine: Arm26Machine) => (machine.cpu.psr & 0xF0000000) >>> 0

/** Vectors that branch to labels a test defines, so a test owns reset. */
const VECTORS = `	.org 0
	b reset
	b undefined
	b swi
	b prefetch
	b abort
	b address
	b irq
	b fiq
`

describe('ARM26 flags', () => {
	it('sets Z and C on a subtraction to zero', () => {
		const machine = run('\tmov r0, #1\n\tsubs r0, r0, #1\n\tswi OS_Exit\n')
		expect(flags(machine)).toBe(FLAG_Z | FLAG_C)
	})

	it('sets N and V on signed overflow', () => {
		const machine = run('\tmvn r0, #0x80000000\n\tadds r0, r0, #1\n\tswi OS_Exit\n')
		expect(r(machine, 0) >>> 0).toBe(0x80000000)
		expect(flags(machine)).toBe((FLAG_N | FLAG_V) >>> 0)
	})

	it('takes C from the shifter for logical S instructions', () => {
		const machine = run('\tmov r1, #0x80000000\n\tmovs r0, r1, lsl #1\n\tswi OS_Exit\n')
		expect(flags(machine)).toBe(FLAG_Z | FLAG_C)
		// A rotated immediate carries out its bit 31.
		expect(flags(run('\tmovs r0, #0xF0000000\n\tswi OS_Exit\n'))).toBe((FLAG_N | FLAG_C) >>> 0)
		// RRX shifts the carry in and bit 0 out.
		const rrx = run('\tmov r1, #3\n\tsubs r2, r1, #0\n\tmovs r0, r1, rrx\n\tswi OS_Exit\n')
		expect(r(rrx, 0) >>> 0).toBe(0x80000001)
		expect(flags(rrx)).toBe((FLAG_N | FLAG_C) >>> 0)
	})

	it('skips an instruction whose condition fails', () => {
		const machine = run('\tcmp r0, #0\n\tmovne r1, #1\n\tmoveq r2, #2\n\tswi OS_Exit\n')
		expect(r(machine, 1)).toBe(0)
		expect(r(machine, 2)).toBe(2)
	})

	it('multiplies, setting N and Z only', () => {
		const machine = run('\tmov r1, #6\n\tmov r2, #7\n\tmov r3, #8\n\tsubs r4, r1, #0\n\tmlas r0, r1, r2, r3\n\tswi OS_Exit\n')
		expect(r(machine, 0)).toBe(50)
		expect(flags(machine)).toBe(FLAG_C)
	})
})

describe('ARM26 R15', () => {
	it('reads as PC + 8, with the status bits only as Rm', () => {
		const machine = run('\tcmp r0, #0\n\tmov r0, pc\n\tadd r1, pc, #0\n\tswi OS_Exit\n')
		// mov at 0x8004: Rm gets PC + 8 and Z and C.
		expect(r(machine, 0) >>> 0).toBe((0x800C | FLAG_Z | FLAG_C) >>> 0)
		expect(r(machine, 1)).toBe(0x8010)
	})

	it('reads as PC + 12 with a register shift, and when stored', () => {
		const machine = run('\tmov r4, #0\n\tmov r3, pc, lsl r4\n\tadr r5, slot\n\tstr pc, [r5]\n\tswi OS_Exit\nslot:\t.word 0\n')
		expect(r(machine, 3)).toBe(0x8004 + 12)
		expect(machine.cpu.readWord(0x8014)).toBe(0x800C + 12)
	})

	it('BL saves the flags with the return address, and MOVS PC, LR restores them', () => {
		const machine = run('\tcmp r0, #0\n\tbl sub\n\tmov r5, pc\n\tswi OS_Exit\nsub:\tcmp r0, #1\n\tmov r6, lr\n\tmovs pc, lr\n')
		expect(r(machine, 6) >>> 0).toBe((0x8008 | FLAG_Z | FLAG_C) >>> 0)
		expect(flags(machine)).toBe(FLAG_Z | FLAG_C)
		// MOV PC, LR without S keeps the callee's flags.
		const plain = run('\tcmp r0, #0\n\tbl sub\n\tswi OS_Exit\nsub:\tcmp r0, #1\n\tmov pc, lr\n')
		expect(flags(plain)).toBe(FLAG_N)
	})

	it('LDR into PC moves the PC and leaves the status bits', () => {
		const machine = run('\tcmp r0, #0\n\tldr pc, =there\n\tmov r1, #1\nthere:\tswi OS_Exit\n')
		expect(r(machine, 1)).toBe(0)
		expect(flags(machine)).toBe(FLAG_Z | FLAG_C)
	})

	it('USR mode cannot change mode or the interrupt masks, only NZCV', () => {
		const machine = run('\tteqp pc, #0xF0000003\n\tswi OS_Exit\n')
		expect(machine.cpu.mode).toBe(MODE_USR)
		expect(flags(machine)).toBe(0xF0000000)
		expect(machine.cpu.psr & (PSR_I | PSR_F)).toBe(0)
	})
})

describe('ARM26 modes and exceptions', () => {
	it('resets into SVC with interrupts off when the program owns address 0', () => {
		const machine = boot(`${VECTORS}reset:\nundefined:\nswi:\nprefetch:\nabort:\naddress:\nirq:\nfiq:\tb .\n`)
		expect(machine.cpu.pc).toBe(0)
		expect(machine.cpu.mode).toBe(MODE_SVC)
		expect(machine.cpu.psr & (PSR_I | PSR_F)).toBe(PSR_I | PSR_F)
		// Otherwise USR at the entry.
		const application = boot('\tswi OS_Exit\n')
		expect(application.cpu.pc).toBe(0x8000)
		expect(application.cpu.mode).toBe(MODE_USR)
	})

	it('banks R13 and R14 for SVC and IRQ, and R8-R14 for FIQ', () => {
		const code = `${VECTORS}reset:
	mov r8, #8
	mov r13, #0x1300
	teqp pc, #2            @ IRQ
	mov r13, #0x2300
	teqp pc, #1            @ FIQ
	mov r8, #0x88
	mov r13, #0x3300
	teqp pc, #3            @ SVC again
	mov r0, r8
	mov r1, r13
	swi OS_Exit
undefined:
swi:
prefetch:
abort:
address:
irq:
fiq:	b .
`
		const machine = run(code.replace('swi OS_Exit', 'swi 0x11').replace(/^\tb swi$/m, '\t.word 0'))
		expect(r(machine, 0)).toBe(8)
		expect(r(machine, 1)).toBe(0x1300)
		const { registers } = machine.cpu
		expect(registers[BANKS[MODE_IRQ][13]]).toBe(0x2300)
		expect(registers[BANKS[MODE_FIQ][13]]).toBe(0x3300)
		expect(registers[BANKS[MODE_FIQ][8]]).toBe(0x88)
		expect(registers[BANKS[MODE_USR][13]]).toBe(MEMORY)
	})

	it('takes SWI through a programmed vector and returns with MOVS PC, R14', () => {
		const code = `${VECTORS}reset:
	teqp pc, #0            @ to USR, interrupts on
	mov r0, #5
	swi 0x123
	mov r2, r0
	b .
swi:
	ldr r1, [r14, #-4]     @ the SWI instruction
	bic r1, r1, #0xFF000000
	add r0, r0, #1
	movs pc, r14
undefined:
prefetch:
abort:
address:
irq:
fiq:	b .
`
		const machine = boot(code)
		const cpu = machine.cpu
		for (let step = 0; step < 3; step++) machine.step()
		expect(machine.step()).toBe(STEP_EXCEPTION)
		expect(cpu.mode).toBe(MODE_SVC)
		expect(cpu.pc).toBe(0x08)
		expect(cpu.psr & PSR_I).toBe(PSR_I)
		// R14_svc: the return address with USR's status bits.
		expect(r(machine, 14) >>> 0).toBe(0x2C)
		for (let step = 0; step < 6; step++) machine.step()
		expect(r(machine, 1)).toBe(0x123)
		expect(r(machine, 2)).toBe(6)
		expect(cpu.mode).toBe(MODE_USR)
		expect(cpu.psr & PSR_I).toBe(0)
	})

	it('traps an undefined instruction, or stops when there is no handler', () => {
		const handled = boot(`${VECTORS}reset:\n\t.word 0xE7F000F0\n\tb .\nundefined:\tmov r0, r14\n\tb .\nswi:\nprefetch:\nabort:\naddress:\nirq:\nfiq:\tb .\n`)
		handled.step()
		expect(handled.step()).toBe(STEP_EXCEPTION)
		expect(handled.cpu.pc).toBe(0x04)
		handled.step()
		handled.step()
		expect(r(handled, 0) >>> 0).toBe((0x24 | MODE_SVC | PSR_I | PSR_F) >>> 0)
		const bare = boot('\tmov r0, #1\n\t.word 0xEE000000\n')
		expect(bare.step()).toBe(STEP_OK)
		expect(bare.step()).toBe(STEP_FAULT)
		expect(bare.cpu.fault).toBe(FAULT_UNDEFINED)
		expect(bare.cpu.pc).toBe(0x8004)
	})

	it('raises a data abort past RAM and an address exception past 26 bits', () => {
		const abort = boot('\tmov r1, #0x100000\n\tldr r0, [r1]\n')
		abort.step()
		expect(abort.step()).toBe(STEP_FAULT)
		expect(abort.cpu.fault).toBe(FAULT_DATA_ABORT)
		const address = boot('\tmov r1, #0x04000000\n\tstr r0, [r1]\n')
		address.step()
		expect(address.step()).toBe(STEP_FAULT)
		expect(address.cpu.fault).toBe(FAULT_ADDRESS)
		const handled = boot(`${VECTORS}reset:\n\tmov r1, #0x04000000\n\tldr r0, [r1]\nundefined:\nswi:\nprefetch:\nabort:\nirq:\nfiq:\tb .\naddress:\tmov r2, r14\n\tb .\n`)
		handled.step()
		handled.step()
		expect(handled.step()).toBe(STEP_EXCEPTION)
		expect(handled.cpu.pc).toBe(0x14)
		handled.step()
		handled.step()
		// The faulting LDR at 0x24, plus 8.
		expect(r(handled, 2) & 0x03FFFFFC).toBe(0x2C)
	})
})

describe('ARM26 memory', () => {
	it('rotates an unaligned LDR and swaps with SWP', () => {
		const code = '\tadr r1, data\n\tldr r0, [r1, #1]\n\tmov r2, #0x55\n\tswpb r3, r2, [r1]\n\tswp r4, r2, [r1]\n\tswi OS_Exit\ndata:\t.word 0x44332211\n'
		const machine = run(code)
		expect(r(machine, 0) >>> 0).toBe(0x11443322)
		expect(r(machine, 3)).toBe(0x11)
		expect(r(machine, 4) >>> 0).toBe(0x44332255)
		expect(machine.cpu.readWord(0x8018)).toBe(0x55)
	})

	it('pushes and pops with LDM and STM, storing a written-back base as it was when first', () => {
		const machine = run('\tmov r0, #1\n\tmov r1, #2\n\tstmfd sp!, {r0, r1, lr}\n\tldmfd sp!, {r2, r3}\n\tadd sp, sp, #4\n\tadr r5, area\n\tstmia r5!, {r5, r6}\n\tswi OS_Exit\narea:\t.word 0, 0\n')
		expect(r(machine, 2)).toBe(1)
		expect(r(machine, 3)).toBe(2)
		expect(r(machine, 13)).toBe(MEMORY)
		expect(machine.cpu.readWord(0x8020)).toBe(0x8020)
		expect(r(machine, 5)).toBe(0x8028)
	})

	it('STM ^ stores the user bank from a privileged mode', () => {
		const code = `${VECTORS}reset:\n\tmov r13, #0x100\n\tadr r0, area\n\tstmia r0, {r13}^\n\tswi OS_Exit\nundefined:\nswi:\nprefetch:\nabort:\naddress:\nirq:\nfiq:\tb .\narea:\t.word 0\n`
		const machine = run(code.replace(/^\tb swi$/m, '\t.word 0'))
		expect(machine.cpu.readWord(machine.cpu.register(0))).toBe(MEMORY)
	})
})
