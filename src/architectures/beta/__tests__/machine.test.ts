import { describe, expect, it } from 'vitest'
import { BetaCpu, FAULT_ILLEGAL_INSTRUCTION, R_XP, STEP_FAULT, STEP_HALT, STEP_OK, STEP_TRAP, STEP_WAIT, type BetaEffectSink } from '../cpu'
import { BSIM_PROFILE, BetaConsole, BetaMachine } from '../machine'
import { assembleUasm } from '../uasm'

const SUPERVISOR = 0x80000000
// PRIV_OP(code) from beta.uasm: opcode 0, Ra = Rc = R0, literal = code.
const priv = (code: number, ra = 0) => ((ra << 16) | (code & 0xFFFF)) >>> 0
const HALT = priv(0)
const RDCHAR = priv(1)
const WRCHAR = priv(2)

function machine(words: number[], { supervisor = true, tty = true } = {}) {
	const cpu = new BetaCpu({ memoryBytes: 0x100 })
	words.forEach((word, index) => cpu.writeWord(index * 4, word))
	cpu.pc = supervisor ? SUPERVISOR : 0
	const console = new BetaConsole({ tty })
	cpu.privileged = console
	return { cpu, console }
}

describe('Beta privileged operations', () => {
	it('halts on HALT, leaving the PC on it', () => {
		const { cpu } = machine([HALT])
		expect(cpu.step()).toBe(STEP_HALT)
		expect(cpu.pc).toBe(SUPERVISOR)
		expect(cpu.step()).toBe(STEP_HALT)
	})

	it('halts on the zero word in user mode too, as BSim does', () => {
		const { cpu } = machine([HALT], { supervisor: false })
		expect(cpu.step()).toBe(STEP_HALT)
		expect(cpu.pc).toBe(0)
	})

	it('writes the low byte of Ra with WRCHAR', () => {
		const { cpu, console } = machine([WRCHAR, priv(2, 5)])
		cpu.setRegister(0, 0x141)
		cpu.setRegister(5, 0x62)
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.step()).toBe(STEP_OK)
		expect(console.output).toBe('Ab')
		expect(cpu.pc).toBe(SUPERVISOR + 8)
	})

	it('waits in RDCHAR without input, then reads into R0 with CR as LF', () => {
		const { cpu, console } = machine([RDCHAR, RDCHAR])
		expect(cpu.step()).toBe(STEP_WAIT)
		expect(cpu.pc).toBe(SUPERVISOR)
		expect(console.waiting).toBe(true)
		console.feed('\r')
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.registers[0]).toBe(10)
		expect(console.waiting).toBe(false)
		console.feed('z')
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.registers[0]).toBe(0x7A)
	})

	it('records the RDCHAR write for rewind', () => {
		const { cpu, console } = machine([RDCHAR])
		const log: string[] = []
		const sink: BetaEffectSink = {
			register: (index, old) => log.push(`r${index}=${old}`),
			memory: () => log.push('memory'),
			pc: (old) => log.push(`pc=${old}`),
		}
		cpu.sink = sink
		cpu.setRegister(0, 7)
		expect(cpu.step()).toBe(STEP_WAIT)
		expect(log).toEqual([])
		console.feed('a')
		cpu.step()
		expect(log).toEqual(['r0=7', `pc=${SUPERVISOR}`])
	})

	it('treats RDCHAR and WRCHAR as illegal without .options tty', () => {
		for (const word of [RDCHAR, WRCHAR]) {
			const { cpu, console } = machine([word], { tty: false })
			expect(cpu.step()).toBe(STEP_FAULT)
			expect(cpu.fault).toBe(FAULT_ILLEGAL_INSTRUCTION)
			expect(console.output).toBe('')
		}
	})

	it('traps every privileged op but the zero word in user mode', () => {
		for (const word of [priv(0, 1), RDCHAR, WRCHAR]) {
			const { cpu } = machine([word], { supervisor: false })
			expect(cpu.step()).toBe(STEP_TRAP)
			expect(cpu.registers[R_XP]).toBe(4)
			expect(cpu.pc).toBe(SUPERVISOR + 4)
		}
	})

	it('reads CLICK as -1, no click, and needs tty', () => {
		const { cpu } = machine([priv(5)])
		cpu.setRegister(0, 7)
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.registers[0]).toBe(-1)
		const silent = machine([priv(5)], { tty: false })
		expect(silent.cpu.step()).toBe(STEP_FAULT)
	})

	it('leaves the other codes illegal', () => {
		for (const code of [3, 4, 6, 7, 8, 9, 0xFFFF]) {
			const { cpu } = machine([priv(code)])
			expect(cpu.step()).toBe(STEP_FAULT)
			expect(cpu.fault).toBe(FAULT_ILLEGAL_INSTRUCTION)
		}
	})

	it('keeps opcode 0 illegal with no profile attached', () => {
		const cpu = new BetaCpu({ memoryBytes: 0x100 })
		cpu.pc = SUPERVISOR
		expect(cpu.step()).toBe(STEP_FAULT)
		expect(cpu.fault).toBe(FAULT_ILLEGAL_INSTRUCTION)
	})
})

describe('BSim profile', () => {
	it('matches the vector names the bundled beta.uasm defines', () => {
		const names = ['VEC_RESET', 'VEC_II', 'VEC_SEGFAULT', 'VEC_CLK', 'VEC_KBD', 'VEC_MOUSE']
		const { image, diagnostics } = assembleUasm({ name: 'main.uasm', code: `.include "beta.uasm"\n${names.join(' ')}` })
		expect(diagnostics).toEqual([])
		const { reset, illegal, segfault, clock, keyboard, mouse } = BSIM_PROFILE.vectors
		expect([...image!.sections[0].bytes]).toEqual([reset, illegal, segfault, clock, keyboard, mouse])
		expect([reset, illegal, segfault, clock, keyboard, mouse]).toEqual([0, 4, 8, 12, 16, 20])
	})

	it('traps segmentation faults to its vector', () => {
		const m = new BetaMachine({ memoryBytes: 0x100, segmentation: true })
		m.cpu.segBounds = 8
		m.cpu.pc = 8
		expect(m.step()).toBe(STEP_TRAP)
		expect([m.cpu.pc, m.cpu.registers[R_XP]]).toEqual([SUPERVISOR + 8, 8])
	})

	it('raises interrupts at a profile vector with XP = PC + 4', () => {
		const m = new BetaMachine({ memoryBytes: 0x100 })
		m.cpu.pc = 0x20
		expect(m.interrupt(BSIM_PROFILE.vectors.clock)).toBe(true)
		expect([m.cpu.pc, m.cpu.registers[R_XP]]).toEqual([SUPERVISOR + 12, 0x24])
	})
})
