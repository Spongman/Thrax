/** VFPv4-D16 semantics on the AArch32 machine: rounding, NaNs, flags, conversions, conditions and history. */

import { describe, expect, it } from 'vitest'
import { TEXT_BASE } from '../../a64/layout'
import { FAULT_ALIGNMENT, FAULT_UNDEFINED, STEP_FAULT, STEP_HALT, STEP_OK } from '../cpu'
import { A32Machine } from '../machine'
import { assembleA32, createA32State } from '../state'
import type { A32Runtime } from '../runtime'
import { A32_REGISTERS } from '../registers'
import { a32Profile } from '../profile'
import { a32InstructionSet } from '../instructions'
import { FORMAT_VFP } from '../../shared/a32/isa'
import { RegisterFormat } from '../../../contracts'

const EXIT = '\tmov r7, #1\n\tsvc #0\n'

/** FPSCR bits. */
const IOC = 1, IXC = 16, IDC = 128
const DN = 1 << 25, FZ = 1 << 24, RP = 1 << 22, RZ = 3 << 22

function load(code: string, options: { historyLimit?: number, floatingPoint?: boolean } = {}): A32Machine {
	const result = assembleA32({ name: 'test.s', code: `${code}\n${EXIT}` })
	expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
	const machine = new A32Machine({ memoryBytes: 1 << 20, ...options })
	machine.load(result.image!)
	return machine
}

function run(code: string): A32Machine {
	const machine = load(code)
	expect(machine.run(10_000)).toBe(STEP_HALT)
	return machine
}

const s = (machine: A32Machine, index: number) => machine.cpu.s[index] >>> 0
const d = (machine: A32Machine, index: number) => (BigInt(machine.cpu.s[2 * index + 1]) << 32n) | BigInt(machine.cpu.s[2 * index])
const f32 = (bits: number) => new Float32Array(new Uint32Array([bits]).buffer)[0]
const f64 = (bits: bigint) => new Float64Array(new BigUint64Array([bits]).buffer)[0]
const flags = (machine: A32Machine) => machine.cpu.fpscr & 0x9F

/** Sets FPSCR to `value` first. */
const withFpscr = (value: number, code: string) => `\tldr r0, =${value}\n\tvmsr fpscr, r0\n${code}`

/** Loads S0 and S1 with the words given. */
const operands = (a: number, b: number, code: string) => `\tldr r0, =${a}\n\tvmov s0, r0\n\tldr r0, =${b}\n\tvmov s1, r0\n${code}`

describe('VFP arithmetic', () => {
	it('computes in single and double precision', () => {
		const machine = run([
			'\tvmov.f32 s0, #1.5', '\tvmov.f32 s1, #2.0', '\tvadd.f32 s2, s0, s1', '\tvmul.f32 s3, s0, s1', '\tvdiv.f32 s4, s0, s1', '\tvsub.f32 s5, s0, s1',
			'\tvmov.f64 d4, #2.0', '\tvsqrt.f64 d5, d4', '\tvneg.f64 d6, d5', '\tvabs.f64 d7, d6', '\tvnmul.f32 s6, s0, s1',
		].join('\n'))
		expect([2, 3, 4, 5, 6].map((index) => f32(s(machine, index)))).toEqual([3.5, 3, 0.75, -0.5, -3])
		expect(f64(d(machine, 5))).toBe(Math.SQRT2)
		expect(f64(d(machine, 6))).toBe(-Math.SQRT2)
		expect(f64(d(machine, 7))).toBe(Math.SQRT2)
		expect(flags(machine)).toBe(IXC)
	})

	it('rounds in the FPSCR mode and accumulates IXC', () => {
		const sum = (fpscr: number) => run(withFpscr(fpscr, operands(0x3F800000, 0x33800000, '\tvadd.f32 s2, s0, s1')))
		expect(s(sum(0), 2)).toBe(0x3F800000)
		expect(s(sum(RP), 2)).toBe(0x3F800001)
		expect(s(sum(RZ), 2)).toBe(0x3F800000)
		expect(flags(sum(RP))).toBe(IXC)
	})

	it('propagates NaNs, quietening a signalling one, or gives the default NaN', () => {
		const machine = run(operands(0x7FC00001, 0x7F800002, '\tvadd.f32 s2, s0, s1'))
		expect(s(machine, 2)).toBe(0x7FC00002)
		expect(flags(machine)).toBe(IOC)
		expect(s(run(withFpscr(DN, operands(0xFFC00001, 0x3F800000, '\tvmul.f32 s2, s0, s1'))), 2)).toBe(0x7FC00000)
	})

	it('flushes denormals to zero under FZ', () => {
		const machine = run(withFpscr(FZ, operands(0x00000001, 0x3F800000, '\tvmul.f32 s2, s0, s1')))
		expect(s(machine, 2)).toBe(0)
		expect(flags(machine)).toBe(IDC)
		expect(s(run(operands(0x00000001, 0x3F800000, '\tvmul.f32 s2, s0, s1')), 2)).toBe(1)
	})

	it('chains VMLA through two roundings and VFMA through one', () => {
		// d0 = -1 and d2 = 1 + 2^-50 (low word 4), whose square 1 + 2^-49 + 2^-100 rounds to 1 + 2^-49.
		const program = (op: string) => `\tvmov.f64 d0, #-1.0\n\tldr r0, =4\n\tldr r1, =0x3FF00000\n\tvmov d2, r0, r1\n\t${op}.f64 d0, d2, d2`
		const result = (op: string) => f64(d(run(program(op)), 0))
		expect(result('vfma')).toBe(2 ** -49 + 2 ** -100)
		expect(result('vmla')).toBe(2 ** -49)
		expect(result('vfms')).toBe(-2 - 2 ** -49)
		expect(result('vmls')).toBe(-2 - 2 ** -49)
		expect(result('vnmla')).toBe(-(2 ** -49))
		expect(result('vfnma')).toBe(-(2 ** -49 + 2 ** -100))
		expect(result('vnmls')).toBe(2 + 2 ** -49)
		expect(result('vfnms')).toBe(2 + 2 ** -49)
	})
})

describe('VFP conversions', () => {
	const toInt = (bits: number, instruction: string, fpscr = 0) => run(withFpscr(fpscr, operands(bits, 0, `\t${instruction} s2, s0`)))

	it('truncates with VCVT and rounds in the FPSCR mode with VCVTR', () => {
		expect(s(toInt(0xC02CCCCD, 'vcvt.s32.f32'), 2) | 0).toBe(-2)
		expect(s(toInt(0x40200000, 'vcvtr.s32.f32'), 2)).toBe(2)
		expect(s(toInt(0x40200000, 'vcvtr.s32.f32', RP), 2)).toBe(3)
		expect(flags(toInt(0x40200000, 'vcvtr.s32.f32'))).toBe(IXC)
	})

	it('saturates with IOC rather than IXC', () => {
		const big = toInt(0x4F32D05E, 'vcvt.s32.f32')
		expect(s(big, 2)).toBe(0x7FFFFFFF)
		expect(flags(big)).toBe(IOC)
		const negative = toInt(0xBF800000, 'vcvt.u32.f32')
		expect(s(negative, 2)).toBe(0)
		expect(flags(negative)).toBe(IOC)
		expect(s(toInt(0x4F32D05E, 'vcvt.u32.f32'), 2)).toBe(3000000000)
		expect(s(toInt(0x7FC00000, 'vcvt.s32.f32'), 2)).toBe(0)
	})

	it('converts integers and precisions', () => {
		const machine = run(operands(0xFFFFFFFD, 0xFFFFFFFD, '\tvcvt.f64.s32 d1, s0\n\tvcvt.f32.u32 s4, s1\n\tvcvt.f32.f64 s5, d1\n\tvcvt.f64.f32 d3, s5'))
		expect(f64(d(machine, 1))).toBe(-3)
		expect(f32(s(machine, 4))).toBe(4294967296)
		expect(f32(s(machine, 5))).toBe(-3)
		expect(f64(d(machine, 3))).toBe(-3)
	})

	it('converts to and from fixed point in place', () => {
		const machine = run(operands(0x3FC00000, 0xBFC00000, '\tvcvt.s32.f32 s0, s0, #16\n\tvmov r3, s0\n\tvcvt.f32.s32 s0, s0, #16\n\tvcvt.s16.f32 s1, s1, #4'))
		expect(machine.cpu.r[3]).toBe(0x18000)
		expect(f32(s(machine, 0))).toBe(1.5)
		// -1.5 * 16 is -24, sign-extended from 16 bits.
		expect(s(machine, 1)).toBe(0xFFFFFFE8)
	})
})

describe('VFP compares and conditions', () => {
	it('moves the comparison into the APSR for a conditional VFP instruction', () => {
		const machine = run(operands(0x3F800000, 0x40000000, '\tvcmp.f32 s0, s1\n\tvmrs APSR_nzcv, fpscr\n\tvmovlt.f32 s2, s0\n\tvmovge.f32 s3, s1'))
		expect(machine.cpu.fpscr >>> 28).toBe(0b1000)
		expect(machine.cpu.cpsr >>> 28).toBe(0b1000)
		expect(s(machine, 2)).toBe(0x3F800000)
		expect(s(machine, 3)).toBe(0)
	})

	it('compares unordered with C and V, signalling only for VCMPE', () => {
		const quiet = run(operands(0x7FC00000, 0x3F800000, '\tvcmp.f32 s0, s1'))
		expect(quiet.cpu.fpscr >>> 28).toBe(0b0011)
		expect(flags(quiet)).toBe(0)
		expect(flags(run(operands(0x7FC00000, 0x3F800000, '\tvcmpe.f32 s0, s1')))).toBe(IOC)
		expect(run(operands(0x80000000, 0, '\tvcmp.f32 s0, #0')).cpu.fpscr >>> 28).toBe(0b0110)
	})

	it('changes nothing when the condition fails', () => {
		const machine = load(operands(0x7F800001, 0x3F800000, '\tcmp r0, r0\n\tvaddne.f32 s2, s0, s1\n\tvldrne s3, [r9]\n\tvmrsne r4, fpscr'))
		// Run up to the failing instructions, then step them one at a time.
		for (let step = 0; step < 5; step++) expect(machine.step()).toBe(STEP_OK)
		const before = { s: [...machine.cpu.s], fpscr: machine.cpu.fpscr, r: [...machine.cpu.r], cpsr: machine.cpu.cpsr }
		for (let step = 0; step < 3; step++) {
			expect(machine.step()).toBe(STEP_OK)
			expect(machine.cpu.passed).toBe(false)
		}
		expect({ s: [...machine.cpu.s], fpscr: machine.cpu.fpscr, r: [...machine.cpu.r], cpsr: machine.cpu.cpsr }).toEqual(before)
	})
})

describe('VFP registers and memory', () => {
	it('moves between core registers, S and D', () => {
		const machine = run('\tldr r0, =0x11111111\n\tldr r1, =0x22222222\n\tvmov d2, r0, r1\n\tvmov r2, r3, d2\n\tvmov s0, s1, r1, r0\n\tvmov r4, s4\n\tvmov r5, r6, s0, s1')
		expect(d(machine, 2)).toBe(0x2222222211111111n)
		expect([machine.cpu.r[2], machine.cpu.r[3], machine.cpu.r[4]]).toEqual([0x11111111, 0x22222222, 0x11111111])
		expect([s(machine, 0), s(machine, 1)]).toEqual([0x22222222, 0x11111111])
		expect([machine.cpu.r[5], machine.cpu.r[6]]).toEqual([0x22222222, 0x11111111])
	})

	it('loads, stores, pushes and pops', () => {
		const machine = run([
			'\tldr r0, =values', '\tvldr d0, [r0]', '\tvldr s2, [r0, #8]', '\tvpush {d0-d1}', '\tvmov.f64 d0, #1.0', '\tvpop {s4-s7}',
			'\tvstmdb r0!, {s4-s6}', '\tldr r1, =values', '\tvldmia r1!, {d4}', '\tvstr d0, [r1, #-8]',
			'\t.data', 'values:\t.double -2.5', '\t.float 0.75', '\t.text',
		].join('\n'))
		expect(f64(d(machine, 0))).toBe(1)
		expect(f64(d(machine, 2))).toBe(-2.5)
		expect(f32(s(machine, 6))).toBe(0.75)
		expect(machine.cpu.r[0] >>> 0).toBe(machine.cpu.r[1] - 8 - 12 >>> 0)
		expect(f64(d(machine, 4))).toBe(-2.5)
		// VSTR wrote 1.0 back over the first value.
		expect(new DataView(machine.cpu.memory.buffer).getFloat64(0x20000, true)).toBe(1)
	})

	it('faults on a misaligned VLDR, changing nothing', () => {
		const machine = load('\tldr r0, =0x00420001\n\tvldr s0, [r0]')
		expect(machine.run(100)).toBe(STEP_FAULT)
		expect(machine.cpu.fault).toBe(FAULT_ALIGNMENT)
	})

	it('treats D16-D31 encodings as undefined', () => {
		const machine = load('\t.word 0xEE710B01')
		expect(machine.run(10)).toBe(STEP_FAULT)
		expect(machine.cpu.fault).toBe(FAULT_UNDEFINED)
	})

	it('treats VFP as undefined with floating point off', () => {
		const machine = load('\tvmov.f32 s0, #1.0', { floatingPoint: false })
		expect(machine.run(10)).toBe(STEP_FAULT)
		expect(machine.cpu.fault).toBe(FAULT_UNDEFINED)
		expect(assembleA32({ name: 'test.s', code: '\tvmov.f32 s0, #1.0\n' }, [], 1 << 20, false).diagnostics[0].message).toMatch(/Floating point setting/)
	})
})

describe('VFP history', () => {
	it('steps back to every earlier state exactly', () => {
		const machine = load([
			'\tldr r0, =values', '\tldr r1, =0x00C00000', '\tvmsr fpscr, r1', '\tvldmia r0, {s0-s3}', '\tvadd.f32 s4, s0, s1', '\tvdiv.f64 d3, d0, d1',
			'\tvcmpe.f32 s2, s3', '\tvmrs APSR_nzcv, fpscr', '\tvcvtr.s32.f32 s8, s4', '\tvpush {d0-d3}', '\tvpop {s9-s16}', '\tvmovgt.f32 s17, #3.0',
			'\tvmov r2, r3, d3', '\tvstr d3, [r0, #16]', '\tvsqrt.f32 s18, s9',
			'\t.data', 'values:\t.float 1.25, 3.0', '\t.word 0x7FC00000, 0x7F800001', '\t.double 0', '\t.text',
		].join('\n'), { historyLimit: 1000 })
		const snapshot = () => ({
			s: [...machine.cpu.s], fpscr: machine.cpu.fpscr, cpsr: machine.cpu.cpsr, r: [...machine.cpu.r], pc: machine.cpu.pc,
			memory: [...machine.cpu.memory.slice(0x20000, 0x20020)], stack: [...machine.cpu.memory.slice((1 << 20) - 64)],
		})
		const states = [snapshot()]
		while (machine.step() === STEP_OK) states.push(snapshot())
		expect(machine.halted).toBe(true)
		expect(states.length).toBeGreaterThan(15)
		// The final exit step changed halt state too; undo it first.
		machine.history!.stepBack()
		for (let index = states.length - 1; index > 0; index--) {
			expect(snapshot(), `state ${index}`).toEqual(states[index])
			expect(machine.history!.stepBack()).toBe(true)
		}
		expect(snapshot()).toEqual(states[0])
		expect(TEXT_BASE).toBe(0x400000)
	})
})

it('runs to exit', () => {
	expect(run('').halted).toBe(true)
	expect(STEP_HALT).toBe(2)
})

describe('VFP in the register panel and the tools', () => {
	const settings = { executionState: 'aarch32', memoryBytes: 1 << 20 }

	function runtime(code: string, floatingPoint?: boolean) {
		const state = createA32State()
		const program = state.assemble({ files: [{ name: 't.s', code: `${code}\n${EXIT}` }], entries: ['t.s'] }, { ...settings, floatingPoint })
		return state.createMachine(program, { ...settings, floatingPoint }, { speed: null, historyLimit: 100 }) as A32Runtime
	}

	it('lists S0-S31 as floats paired into D0-D15, and FPSCR', () => {
		const s0 = A32_REGISTERS.find((register) => register.id === 'S0')!
		expect(s0).toMatchObject({ bank: 'vfp', bits: 32, format: RegisterFormat.FLOAT, pairsWith: 'S1' })
		expect(A32_REGISTERS.find((register) => register.id === 'S1')!.pairsWith).toBeUndefined()
		expect(A32_REGISTERS.some((register) => register.id === 'FPSCR')).toBe(true)
		expect(a32Profile(1 << 20).resetRegisters.S31).toBe(0)
	})

	it('shows and edits S registers and FPSCR, and steps the edits back', () => {
		const machine = runtime('\tvmov.f32 s1, #1.0')
		machine.step()
		expect(machine.registerValues().S1).toBe(0x3F800000)
		expect(machine.writeRegister('S2', 0x40000000)).toBe(true)
		expect(machine.writeRegister('FPSCR', 0xFFFFFFFF)).toBe(true)
		expect(machine.registerValues()).toMatchObject({ S2: 0x40000000, FPSCR: 0xF7C0009F })
		const effects = machine.historyFormat.effects(machine.history.at(machine.history.length - 1)!, true)
		expect(effects.map((effect) => effect.label)).toEqual([expect.stringMatching(/FPSCR/)])
		machine.stepBack()
		machine.stepBack()
		expect(machine.registerValues()).toMatchObject({ S2: 0, FPSCR: 0 })
	})

	it('names the VFP format and counts VFP memory traffic for the tools', () => {
		const info = a32InstructionSet.describe(0xED900B00)
		expect(info.isLoad).toBe(true)
		expect(info.mnemonic).toBe('vldr')
		expect(a32InstructionSet.encodings[FORMAT_VFP]).toBe('Floating point (VFP)')
		expect(a32InstructionSet.describe(0xEEF1FA10).writes).toContain(16)
		expect(a32InstructionSet.describe(0xEEF1FA10).isJump).toBe(false)
	})
})
