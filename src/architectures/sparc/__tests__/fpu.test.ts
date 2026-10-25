import { afterEach, describe, expect, it } from 'vitest'
import definition from '../index'
import { decode, encode } from '../isa'
import { examples } from '../examples'
import type { ArchitectureServices, Machine } from '../../contracts'
import type { ConfiguredRuntime } from '../../../core/configuredRuntime'

const services: ArchitectureServices[] = []
function load(code: string) {
	const service = definition.createServices()
	services.push(service)
	const program = service.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, {})
	expect(program.diagnostics).toEqual([])
	const machine = service.createMachine(program, {}, { speed: null, historyLimit: 1000000 }) as ConfiguredRuntime
	return { machine, program, service }
}
function steps(machine: Machine, count: number) { for (let i = 0; i < count; i++) machine.step() }
function run(machine: Machine) { for (let i = 0; !machine.halted && i < 1000000; i++) machine.step(); expect(machine.halted).toBe(true) }
const word = (n: number) => [n >>> 24, n >>> 16 & 255, n >>> 8 & 255, n & 255]
const f32 = (value: number) => { const view = new DataView(new ArrayBuffer(4)); view.setFloat32(0, value); return view.getUint32(0) }
const fsr = (machine: Machine) => Number(machine.registerValues().fsr)
const fcc = (machine: Machine) => fsr(machine) >>> 10 & 3
const cexc = (machine: Machine) => fsr(machine) & 31
const aexc = (machine: Machine) => fsr(machine) >>> 5 & 31
const NV = 16, OF = 8, DZ = 2, NX = 1
afterEach(() => { for (const service of services.splice(0)) service.dispose() })

// Words assembled by hand from the V8 manual's format 3 (op=2, op3=0x34/0x35, opf)
// and format 2 (op2=6) fields: rd=%f2, rs1=%f4, rs2=%f6 unless noted.
describe('SPARC V8 floating-point encodings', () => {
	it.each([
		['fadds', ['%f4', '%f6', '%f2'], 0x85a10826], ['faddd', ['%f4', '%f6', '%f2'], 0x85a10846],
		['fsubs', ['%f4', '%f6', '%f2'], 0x85a108a6], ['fsubd', ['%f4', '%f6', '%f2'], 0x85a108c6],
		['fmuls', ['%f4', '%f6', '%f2'], 0x85a10926], ['fmuld', ['%f4', '%f6', '%f2'], 0x85a10946],
		['fdivs', ['%f4', '%f6', '%f2'], 0x85a109a6], ['fdivd', ['%f4', '%f6', '%f2'], 0x85a109c6],
		['fsmuld', ['%f4', '%f6', '%f2'], 0x85a10d26],
		['fitos', ['%f6', '%f2'], 0x85a01886], ['fitod', ['%f6', '%f2'], 0x85a01906],
		['fstoi', ['%f6', '%f2'], 0x85a01a26], ['fdtoi', ['%f6', '%f2'], 0x85a01a46],
		['fstod', ['%f6', '%f2'], 0x85a01926], ['fdtos', ['%f6', '%f2'], 0x85a018c6],
		['fmovs', ['%f6', '%f2'], 0x85a00026], ['fnegs', ['%f6', '%f2'], 0x85a000a6], ['fabss', ['%f6', '%f2'], 0x85a00126],
		['fsqrts', ['%f6', '%f2'], 0x85a00526], ['fsqrtd', ['%f6', '%f2'], 0x85a00546],
		['fcmps', ['%f4', '%f6'], 0x81a90a26], ['fcmpd', ['%f4', '%f6'], 0x81a90a46],
		['fcmpes', ['%f4', '%f6'], 0x81a90aa6], ['fcmped', ['%f4', '%f6'], 0x81a90ac6],
		['faddq', ['%f4', '%f8', '%f0'], 0x81a10868], ['fcmpq', ['%f4', '%f8'], 0x81a90a68],
		['ldf', ['[%o0+4]', '%f2'], 0xc5022004], ['ld', ['[%o0+4]', '%f2'], 0xc5022004],
		['lddf', ['[%o0+8]', '%f2'], 0xc51a2008], ['ldd', ['[%o0+8]', '%f2'], 0xc51a2008],
		['ldfsr', ['[%o0]', '%fsr'], 0xc10a2000], ['ld', ['[%o0]', '%fsr'], 0xc10a2000],
		['stf', ['%f2', '[%o0+4]'], 0xc5222004], ['st', ['%f2', '[%o0+4]'], 0xc5222004],
		['stdf', ['%f2', '[%o0+8]'], 0xc53a2008], ['std', ['%f2', '[%o0+8]'], 0xc53a2008],
		['stfsr', ['%fsr', '[%o0]'], 0xc12a2000], ['st', ['%fsr', '[%o0]'], 0xc12a2000],
		['stdfq', ['%fq', '[%o0]'], 0xc1322000],
		['fbn', ['4104'], 0x01800002], ['fbne', ['4104'], 0x03800002], ['fblg', ['4104'], 0x05800002], ['fbul', ['4104'], 0x07800002],
		['fbl', ['4104'], 0x09800002], ['fbug', ['4104'], 0x0b800002], ['fbg', ['4104'], 0x0d800002], ['fbu', ['4104'], 0x0f800002],
		['fba', ['4104'], 0x11800002], ['fbe', ['4104'], 0x13800002], ['fbue', ['4104'], 0x15800002], ['fbge', ['4104'], 0x17800002],
		['fbuge', ['4104'], 0x19800002], ['fble', ['4104'], 0x1b800002], ['fbule', ['4104'], 0x1d800002], ['fbo', ['4104'], 0x1f800002],
		['fbe,a', ['4104'], 0x33800002], ['fbz', ['4092'], 0x13bfffff],
	] as const)('encodes %s %j', (name, operands, expected) => {
		expect(encode(name, operands, { address: 0x1000, value: Number })).toEqual(word(expected))
	})
	it.each([
		[0x85a10826, 'fadds %f4,%f6,%f2'], [0x85a01906, 'fitod %f6,%f2'], [0x81a90ac6, 'fcmped %f4,%f6'],
		[0xc51a2008, 'lddf [%o0+8],%f2'], [0xc12a2000, 'stfsr %fsr,[%o0+0]'], [0x33800002, 'fbe,a 0x1008'],
	])('disassembles 0x%s', (w, text) => {
		const memory = new Uint8Array(0x2000)
		memory.set(word(w), 0x1000)
		expect(decode(memory, 0x1000).text).toBe(text)
	})
	it('rejects misaligned pairs and wrong special registers', () => {
		const c = { address: 0x1000, value: Number }
		expect(() => encode('faddd', ['%f1', '%f2', '%f4'], c)).toThrow(/divisible by 2/)
		expect(() => encode('lddf', ['[%o0]', '%f3'], c)).toThrow(/divisible by 2/)
		expect(() => encode('faddq', ['%f2', '%f4', '%f8'], c)).toThrow(/divisible by 4/)
		expect(() => encode('fadds', ['%f32', '%f1', '%f2'], c)).toThrow(/floating-point register/)
		expect(() => encode('ldfsr', ['[%o0]', '%f0'], c)).toThrow(/%fsr/)
		expect(() => encode('ldd', ['[%o0]', '%fsr'], c)).toThrow(/cannot transfer/)
	})
})

const constants = (...words: number[]) => `.data\nk: .word ${words.map(w => `0x${(w >>> 0).toString(16)}`).join(', ')}\n`

describe('SPARC V8 floating-point semantics', () => {
	it.each([
		[f32(1), f32(2), 1], [f32(2), f32(1), 2], [f32(3), f32(3), 0], [0x7fc00000, f32(1), 3], [0x80000000, 0, 0],
	] as const)('fcmps sets fcc for %s against %s', (a, b, expected) => {
		const { machine } = load(`set k,%g1\nld [%g1],%f0\nld [%g1+4],%f1\nfcmps %f0,%f1\n${constants(a, b)}`)
		steps(machine, 5)
		expect(fcc(machine)).toBe(expected)
		expect(cexc(machine)).toBe(0)
	})
	it('signals invalid on a quiet NaN only for FCMPE, and on a signaling NaN for both', () => {
		const { machine } = load(`set k,%g1\nld [%g1],%f0\nld [%g1+4],%f1\nld [%g1+8],%f2\nfcmps %f0,%f1\nfcmpes %f0,%f1\nfcmps %f2,%f1\n${constants(0x7fc00000, f32(1), 0x7f800001)}`)
		steps(machine, 6); expect([fcc(machine), cexc(machine), aexc(machine)]).toEqual([3, 0, 0])
		machine.step(); expect([fcc(machine), cexc(machine), aexc(machine)]).toEqual([3, NV, NV])
		machine.step(); expect([fcc(machine), cexc(machine), aexc(machine)]).toEqual([3, NV, NV])
	})
	it('faults atomically when FSR.TEM enables the raised exception', () => {
		const { machine } = load(`set k,%g1\nld [%g1],%fsr\nld [%g1+4],%f0\nfcmpes %f0,%f0\n${constants(NV << 23, 0x7fc00000)}`)
		steps(machine, 4)
		const before = machine.registerValues(), state = machine.state.slice()
		expect(() => machine.step()).toThrow(/IEEE_754_exception.*invalid/)
		expect(machine.registerValues()).toEqual(before); expect(machine.state).toEqual(state)
	})
	it('rounds singles once, with every FSR.RD mode', () => {
		// 2^24 + 1 is the first integer a single cannot hold.
		const results: number[] = []
		for (const rd of [0, 1, 2, 3]) {
			const { machine } = load(`set k,%g1\nld [%g1],%fsr\nld [%g1+4],%f0\nfitos %f0,%f1\nld [%g1+8],%f2\nfitos %f2,%f3\n${constants(rd << 30, 16777217, -16777217)}`)
			steps(machine, 7)
			const v = machine.registerValues()
			results.push(Number(v.f1), Number(v.f3))
			expect(cexc(machine)).toBe(NX)
		}
		expect(results).toEqual([f32(16777216), f32(-16777216), f32(16777216), f32(-16777216), f32(16777218), f32(-16777216), f32(16777216), f32(-16777218)])
		const { machine } = load(`set k,%g1\nld [%g1],%f0\nld [%g1+4],%f1\nfadds %f0,%f1,%f2\nfmuls %f0,%f1,%f3\nfdivs %f0,%f1,%f4\n${constants(f32(0.1), f32(0.2))}`)
		steps(machine, 7)
		const a = Math.fround(0.1), b = Math.fround(0.2)
		expect(machine.registerValues()).toMatchObject({ f2: f32(a + b), f3: f32(a * b), f4: f32(a / b) })
	})
	it('converts between formats and integers with truncation, saturation and NaN rules', () => {
		const { machine } = load(`set k,%g1
ld [%g1],%f0
fstoi %f0,%f1
ld [%g1+4],%f2
fstoi %f2,%f3
ldd [%g1+8],%f4
fdtoi %f4,%f6
fdtos %f4,%f7
fstod %f0,%f8
ld [%g1+4],%f10
fstod %f10,%f12
${constants(f32(-2.75), 0x7fc00000, 0x7e37e43c, 0x8800759c)}`)
		steps(machine, 4); expect([Number(machine.registerValues().f1) | 0, cexc(machine)]).toEqual([-2, NX])
		steps(machine, 2); expect([machine.registerValues().f3, cexc(machine)]).toEqual([0x7fffffff, NV])
		// 1e300 does not fit an int32 or a single.
		steps(machine, 2); expect([machine.registerValues().f6, cexc(machine)]).toEqual([0x7fffffff, NV])
		machine.step(); expect([machine.registerValues().f7, cexc(machine)]).toEqual([0x7f800000, OF | NX])
		machine.step(); expect([machine.registerValues().f8, machine.registerValues().f9, cexc(machine)]).toEqual([0xc0060000, 0, 0])
		// A quiet single NaN widens with its payload moved to the top of the double fraction.
		steps(machine, 2); expect([machine.registerValues().f12, machine.registerValues().f13]).toEqual([0x7ff80000, 0])
		expect(aexc(machine)).toBe(NV | OF | NX)
	})
	it('produces infinities, the default NaN and sticky aexc', () => {
		const { machine } = load(`set k,%g1\nld [%g1],%f0\nld [%g1+4],%f1\nfdivs %f0,%f1,%f2\nfdivs %f1,%f1,%f3\nfsqrts %f2,%f4\nfnegs %f0,%f5\nfsqrts %f5,%f6\nfabss %f5,%f7\n${constants(f32(1), 0)}`)
		steps(machine, 5); expect([machine.registerValues().f2, cexc(machine), aexc(machine)]).toEqual([0x7f800000, DZ, DZ])
		machine.step(); expect([machine.registerValues().f3, cexc(machine), aexc(machine)]).toEqual([0x7fffffff, NV, DZ | NV])
		machine.step(); expect([machine.registerValues().f4, cexc(machine)]).toEqual([0x7f800000, 0])
		steps(machine, 2); expect([machine.registerValues().f6, cexc(machine), aexc(machine)]).toEqual([0x7fffffff, NV, DZ | NV])
		machine.step(); expect(machine.registerValues().f7).toBe(f32(1))
	})
	it('propagates NaN operands with SNaN2, SNaN1, QNaN2, QNaN1 precedence', () => {
		const { machine } = load(`set k,%g1\nld [%g1],%f0\nld [%g1+4],%f1\nld [%g1+8],%f2\nld [%g1+12],%f3\nfadds %f0,%f1,%f4\nfadds %f2,%f1,%f5\nfadds %f2,%f3,%f6\nfadds %f3,%f2,%f7\n${constants(0x7fc00001, 0x7fc00002, 0x7f800003, 0x7f800004)}`)
		steps(machine, 7); expect([machine.registerValues().f4, cexc(machine)]).toEqual([0x7fc00002, 0])
		machine.step(); expect([machine.registerValues().f5, cexc(machine)]).toEqual([0x7fc00003, NV])
		machine.step(); expect(machine.registerValues().f6).toBe(0x7fc00004)
		machine.step(); expect(machine.registerValues().f7).toBe(0x7fc00003)
	})
	it('pairs doubles high word first through memory and exact FsMULd', () => {
		const { machine } = load(`set k,%g1\nldd [%g1],%f2\nfaddd %f2,%f2,%f4\nstd %f4,[%g1+8]\nld [%g1+16],%f6\nfsmuld %f6,%f6,%f8\n${constants(0x3ff80000, 1, 0, 0, f32(16777215))}`)
		steps(machine, 5)
		expect(machine.registerValues()).toMatchObject({ f2: 0x3ff80000, f3: 1, f4: 0x40080000, f5: 1 })
		expect([machine.inspectMemory().word(0x10008), machine.inspectMemory().word(0x1000c)]).toEqual([0x40080000, 1])
		steps(machine, 2)
		// (2^24 - 1)^2 needs 48 bits: exact in a double, so no inexact.
		const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, 16777215 * 16777215)
		expect([machine.registerValues().f8, machine.registerValues().f9, cexc(machine)]).toEqual([view.getUint32(0), view.getUint32(4), 0])
	})
	it('faults on misaligned FP accesses, odd doubles, quad FPops and STDFQ', () => {
		const odd = (0x85a00846 | 1 << 14) >>> 0 // faddd %f1,%f6,%f2 cannot come from the assembler
		for (const [code, message] of [
			['ld [%g0+2],%f0', /Misaligned SPARC 4-byte/], ['ldd [%g0+4],%f0', /Misaligned SPARC 8-byte/],
			[`.word 0x${odd.toString(16)}`, /invalid_fp_register/], ['faddq %f0,%f4,%f8', /unimplemented_FPop/],
			['.word 0x81a00000', /unimplemented_FPop/], ['std %fq,[%sp]', /sequence_error/],
		] as const) {
			const { machine } = load(code), before = machine.registerValues(), state = machine.state.slice()
			expect(() => machine.step(), code).toThrow(message)
			expect(machine.registerValues()).toEqual(before); expect(machine.state).toEqual(state)
		}
	})
	it('loads only the writable FSR fields and stores FSR', () => {
		const { machine } = load(`set k,%g1\nld [%g1],%fsr\nst %fsr,[%g1+4]\n${constants(0xffffffff, 0)}`)
		steps(machine, 3)
		expect(fsr(machine)).toBe(0xcfc00fff)
		machine.step(); expect(machine.inspectMemory().word(0x10004)).toBe(0xcfc00fff)
		expect(machine.writeRegister('fsr', 0xffffffff)).toBe(true); expect(fsr(machine)).toBe(0xcfc00fff)
	})
})

describe('SPARC FBfcc control flow', () => {
	// fcc = 1 (less) after comparing 1 with 2; nop separates FCMP and FBfcc.
	const prefix = `set k,%g1\nld [%g1],%f0\nld [%g1+4],%f1\nfcmps %f0,%f1\nnop\n`
	it.each([
		['fbl', [0x101c, 0x1024], 1], ['fbl,a', [0x101c, 0x1024], 1],
		['fbge', [0x101c, 0x1020], 1], ['fbge,a', [0x1020, 0x1024], 0],
		['fba,a', [0x1024, 0x1028], 0], ['fbu', [0x101c, 0x1020], 1], ['fbne', [0x101c, 0x1024], 1], ['fbug,a', [0x1020, 0x1024], 0],
	] as const)('handles %s with its delay instruction', (branch, pcs, slot) => {
		const { machine } = load(`${prefix}${branch} target\ninc %g2\nnop\ntarget: nop\nnop\n${constants(f32(1), f32(2))}`)
		steps(machine, 6); expect(machine.pc).toBe(0x1018)
		machine.step(); expect(machine.pc).toBe(pcs[0])
		const registers = machine.registerValues()
		machine.step(); expect(machine.pc).toBe(pcs[1]); expect(machine.registerValues().g2).toBe(slot)
		machine.stepBack(); expect(machine.registerValues()).toEqual(registers)
	})
	it('faults on an FBfcc directly after an FPop2 compare', () => {
		const { machine } = load(`set k,%g1\nld [%g1],%f0\nfcmps %f0,%f0\nfbe target\nnop\ntarget: nop\n${constants(0)}`)
		steps(machine, 4)
		expect(() => machine.step()).toThrow(/directly after an FPop2/)
		machine.setProgramCounter(0x1010)
		machine.step(); expect(machine.pc).toBe(0x1014)
	})
})

describe('SPARC floating-point history and tools', () => {
	it('steps back to exact FP registers, FSR and pending compare state', () => {
		const { machine } = load(examples.floatingpoint.code)
		const snapshots: [object, Uint32Array][] = []
		while (!machine.halted) { snapshots.push([machine.registerValues(), machine.state.slice()]); machine.step() }
		const end = machine.registerValues()
		expect(Object.keys(end).filter(id => /^f\d+$/.test(id) && end[id] !== 0).length).toBeGreaterThan(8)
		for (let i = snapshots.length - 1; i >= 0; i--) {
			machine.stepBack()
			expect(machine.registerValues()).toEqual(snapshots[i][0]); expect(machine.state).toEqual(snapshots[i][1])
		}
	})
	it('runs the floating-point example', () => {
		const { machine } = load(examples.floatingpoint.code)
		run(machine)
		expect(machine.console).toBe('sqrt(81) * 5 = 45\n1000 * 22 / 7 = 3142\n0.1 + 0.2 > 0.3\n')
	})
	it('draws the MIPS single-precision Mandelbrot iteration counts', () => {
		const { machine } = load(examples.mandelbrot.code)
		run(machine)
		const palette = [0x000030, 0x00104a, 0x001f66, 0x003080, 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0, 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb, 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff, 0x000000]
		const memory = machine.inspectMemory()
		const iterations: number[] = [], expected: number[] = []
		for (let row = 0; row < 32; row++) for (let col = 0; col < 32; col++) {
			// The same single-precision operation order as mips/examples/mandelbrot.asm.
			const step = 2.5 / 32, cx = Math.fround(Math.fround(col * step) - 2), cy = Math.fround(Math.fround(row * step) - 1.25)
			let x = 0, y = 0, n = 0
			for (; n < 16; n++) {
				const xx = Math.fround(x * x), yy = Math.fround(y * y)
				if (Math.fround(xx + yy) > 4) break
				y = Math.fround(Math.fround(Math.fround(x * y) * 2) + cy)
				x = Math.fround(Math.fround(xx - yy) + cx)
			}
			expected.push(n)
			const at = 0x10000 + (row * 32 + col) * 4
			iterations.push(palette.indexOf(memory.byte(at)! | memory.byte(at + 1)! << 8 | memory.byte(at + 2)! << 16))
		}
		expect(iterations).toEqual(expected)
		expect(new Set(expected).size).toBeGreaterThan(8)
	})
	it('shows single values in data tips', () => {
		const { service } = load('nop')
		const tip = service.describeToken!('fadds %f0,%f1,%f2', 7, { registers: { f0: f32(1.5) }, labels: new Map(), memory: undefined! })
		expect(tip).toMatchObject({ register: 'f0', contents: ['**%f0** = 0x3fc00000 (1.5)'] })
	})
	it('lists FP registers with big-endian double pairs', () => {
		expect(definition.registers.find(r => r.id === 'f0')).toMatchObject({ bank: 'FPU', pairsWith: 'f1', highWordFirst: true })
		expect(definition.registers.find(r => r.id === 'f1')?.pairsWith).toBeUndefined()
	})
})
