import { describe, expect, it } from 'vitest'
import { offeredOptions } from '../../../core/settings'
import { variantConfigurations } from '../../../core/variants'
import { variantOf } from '../../contracts'
import definition from '../index'
import { assembleM68k } from '../assembler'
import { FPU_MNEMONICS, m68kInstructionHelp } from '../catalog'
import { decodeInstruction, disassemble } from '../decode'
import { EXAMPLES_68020, EXAMPLES_68020_FPU } from '../examples'
import { toDouble, unpack80 } from '../extended'
import { M68kRuntime } from '../runtime'
import { coprocessorsFor, effectiveCoprocessor, M68K_SETTINGS, type CpuModel } from '../settings'

const source = (code: string) => ({ files: [{ name: 'main.s', code }], entries: ['main.s'] })
const assemble = (code: string, model: CpuModel = '68020', fpu = true) => assembleM68k(source(code), model, fpu ? '68881' : 'none')
function words(code: string) {
	const p = assemble(code)
	expect(p.diagnostics).toEqual([])
	const bytes = p.image().sections[0].bytes,
		view = new DataView(bytes.buffer, bytes.byteOffset)
	return Array.from({ length: bytes.length / 2 }, (_, i) => view.getUint16(i * 2, false))
}
function runtime(code: string) {
	const program = assemble(code)
	expect(program.diagnostics).toEqual([])
	return new M68kRuntime(program, { historyLimit: 100_000, speed: null })
}
function finish(machine: M68kRuntime, limit = 300_000) {
	let steps = 0
	while (!machine.halted && steps++ < limit) machine.step()
	expect(steps).toBeLessThan(limit)
}
/** Runs straight-line code to completion. */
function run(code: string) {
	const m = runtime(`${code}\n\tbkpt #0`)
	finish(m)
	return m
}
const raw = (m: M68kRuntime, n: number) => m.registerValues()[`FP${n}`] as bigint
const value = (m: M68kRuntime, n: number) => toDouble(unpack80(raw(m, n)))
const fpsr = (m: M68kRuntime) => m.registerValues().FPSR as number
// FPSR fields from the MC68881/MC68882 User's Manual, section 1.
const CC_N = 0x08000000, CC_Z = 0x04000000, CC_I = 0x02000000, CC_NAN = 0x01000000
const BSUN = 0x8000, SNAN = 0x4000, OPERR = 0x2000, DZ = 0x0400, INEX2 = 0x0200, INEX1 = 0x0100
const IOP = 0x80, ADZ = 0x10, AINEX = 0x08

describe('MC68881/MC68882 encodings', () => {
	it('matches command words built from the manual field layouts', () => {
		// General: F200 | EA, then 0 R/M 0 source destination opmode.
		expect(words('fmove.x fp0,fp1\nfadd.x fp1,fp2\nfcmp.x fp1,fp0\nftst.x fp0\nfsqrt.x fp0\nfsin.x fp0\nfsincos.x fp0,fp1:fp2')).toEqual([
			0xf200, 0x0080, 0xf200, 0x0522, 0xf200, 0x0438, 0xf200, 0x003a, 0xf200, 0x0004, 0xf200, 0x000e, 0xf200, 0x0131
		])
		expect(words('fmove.l d0,fp0\nfmove.d (a0),fp1\nfmove.x fp1,(a0)\nfmove.l fp0,d0\nfmove.l fp1,d1')).toEqual([
			0xf200, 0x4000, 0xf210, 0x5480, 0xf210, 0x6880, 0xf200, 0x6000, 0xf201, 0x6080
		])
		expect(words('fmove.s #1.0,fp0\nfmove.d #2.5,fp0')).toEqual([0xf23c, 0x4400, 0x3f80, 0, 0xf23c, 0x5400, 0x4004, 0, 0, 0])
		expect(words('fmovecr.x #0,fp0\nfmovecr #$32,fp1')).toEqual([0xf200, 0x5c00, 0xf200, 0x5cb2])
		expect(words('fmove.l d0,fpcr\nfmove.l fpsr,d1\nfmove.l fpiar,d0\nfmovem.l fpcr/fpsr,-(sp)')).toEqual([
			0xf200, 0x9000, 0xf201, 0xa800, 0xf200, 0xa400, 0xf227, 0xb800
		])
		// Predecrement masks list FP7 in bit 7; postincrement masks list FP0 there.
		expect(words('fmovem.x fp2-fp7,-(sp)\nfmovem.x (sp)+,fp2-fp7\nfmovem.x d1,-(a0)')).toEqual([
			0xf227, 0xe0fc, 0xf21f, 0xd03f, 0xf220, 0xe810
		])
		expect(words('fmove.p fp0,(a0){#3}\nfmove.p fp1,(a0){d2}')).toEqual([0xf210, 0x6c03, 0xf210, 0x7ca0])
	})
	it('encodes conditional instructions with their displacement bases', () => {
		expect(words('fnop\nfbeq t\nnop\nt: nop')).toEqual([0xf280, 0, 0xf281, 4, 0x4e71, 0x4e71])
		expect(words('fbogt.l t\nt: nop')).toEqual([0xf2c2, 0, 4, 0x4e71])
		expect(words('loop: fdbne d0,loop\nfseq d0\nftrapne\nftrapgt.w #1')).toEqual([
			0xf248, 0x000e, 0xfffc, 0xf240, 0x0001, 0xf27c, 0x000e, 0xf27a, 0x0012, 1
		])
	})
	it('disassembles the same words', () => {
		const text = (...data: number[]) => disassemble(decodeInstruction((a) => data[(a - 0x1000) / 2], 0x1000, '68020', true))
		expect(text(0xf200, 0x0522)).toBe('fadd.x fp1,fp2')
		expect(text(0xf201, 0x6080)).toBe('fmove.l fp1,d1')
		expect(text(0xf227, 0xe0fc)).toBe('fmovem.x fp2/fp3/fp4/fp5/fp6/fp7,-(a7)')
		expect(text(0xf200, 0x5c00)).toBe('fmovecr.x #$0,fp0')
		expect(text(0xf200, 0x0131)).toBe('fsincos.x fp0,fp1:fp2')
		expect(text(0xf281, 4)).toBe('fbeq.w $1006')
		expect(text(0xf23c, 0x5400, 0x4004, 0, 0, 0)).toBe('fmove.d #2.5,fp0')
		expect(text(0xf280, 0)).toBe('fnop')
	})
	it('rejects FPU instructions without the coprocessor and on 68000/68010', () => {
		for (const model of ['68000', '68010', '68020'] as CpuModel[])
			for (const code of ['fadd.x fp0,fp1', 'fmovecr #0,fp0', 'fnop', 'fbeq $1000'])
				expect(assembleM68k(source(code), model, model === '68020' ? 'none' : '68881').diagnostics.length, `${model} ${code}`).toBeGreaterThan(0)
		for (const model of ['68000', '68010', '68020'] as CpuModel[]) {
			const m = new M68kRuntime(assembleM68k(source('dc.w $f200,$0080'), model), { historyLimit: 10, speed: null })
			expect(() => m.step()).toThrow('MC68881/MC68882')
		}
		for (const code of ['fsave (a0)', 'fmove.x d0,fp0', 'fmove.x fp0,a0', 'fadd.l fp0,fp1', 'fmovem.x (a0)+,-(a1)', 'fmove.p fp0,(a0){#99}'])
			expect(assemble(code).diagnostics.length, code).toBeGreaterThan(0)
	})
})

describe('MC68881/MC68882 settings', () => {
	it('offers the coprocessor only with the MC68020', () => {
		const field = M68K_SETTINGS.fields.find((f) => f.key === 'coprocessor')!
		const options = field.control.kind === 'choice' ? field.control.options : []
		const offered = (cpuModel: CpuModel) => offeredOptions(options, { cpuModel }).map((option) => option.value)
		expect(offered('68000')).toEqual(['none'])
		expect(offered('68010')).toEqual(['none'])
		expect(offered('68020')).toEqual(['none', '68881', '68882'])
		expect(field.visibleWhen!({ cpuModel: '68010', coprocessor: 'none' })).toBe(false)
		expect(coprocessorsFor('68020')).toEqual(['none', '68881', '68882'])
		expect(effectiveCoprocessor({ cpuModel: '68010', coprocessor: '68881' })).toBe('none')
		expect(variantConfigurations(M68K_SETTINGS).filter((s) => s.coprocessor !== 'none')).toEqual([
			{ cpuModel: '68020', coprocessor: '68881' },
			{ cpuModel: '68020', coprocessor: '68882' }
		])
	})
	it('adds FPU registers and examples only with a coprocessor', () => {
		const plain = variantOf(definition, { cpuModel: '68020', coprocessor: 'none' }),
			fpu = variantOf(definition, { cpuModel: '68020', coprocessor: '68882' }),
			fallback = variantOf(definition, { cpuModel: '68000', coprocessor: '68881' })
		expect(plain.examples.floatingpoint).toBeUndefined()
		expect(fallback.examples.floatingpoint).toBeUndefined()
		expect(fpu.examples.floatingpoint.name).toBe('Floating-point Arithmetic')
		expect(fpu.examples.mandelbrot.code).not.toBe(plain.examples.mandelbrot.code)
		expect(plain.examples.mandelbrot.code).toBe(EXAMPLES_68020.mandelbrot.code)
		expect(fpu.registers.map((r) => r.id)).toEqual(expect.arrayContaining(['FP0', 'FP7', 'FPCR', 'FPSR', 'FPIAR']))
		expect(plain.registers.some((r) => r.id === 'FP0')).toBe(false)
		expect(variantOf(definition, { cpuModel: '68020', coprocessor: '68882' })).toBe(fpu)
	})
	it('documents every FPU mnemonic', () => {
		for (const name of FPU_MNEMONICS) expect(m68kInstructionHelp(name)?.contents[2], name).toMatch(/^Syntax: `/)
		expect(m68kInstructionHelp('fadd.x')?.contents[0]).toBe('**[FADD.X](https://m680x0.github.io/ref/floating-point-instructions.html#pf139 "Open FADD.X in the manual")**')
	})
})

describe('MC68881/MC68882 arithmetic', () => {
	it('computes exact extended results and honours FPCR rounding mode and precision', () => {
		let m = run('fmove.s #1.5,fp0\nfadd.d #2.25,fp0\nfmove.l #1,fp1\nfdiv.l #3,fp1')
		expect(raw(m, 0)).toBe(0x4000f000000000000000n)
		// 1/3 = 2^-2 x 1.0101...: round to nearest gives ...AAAB.
		expect(raw(m, 1)).toBe(0x3ffdaaaaaaaaaaaaaaabn)
		expect(fpsr(m) & 0xffff).toBe(INEX2 | AINEX)
		m = run('fmove.l #$10,fpcr\nfmove.l #1,fp1\nfdiv.l #3,fp1')
		expect(raw(m, 1)).toBe(0x3ffdaaaaaaaaaaaaaaaan)
		m = run('fmove.l #$40,fpcr\nfmove.l #1,fp1\nfdiv.l #3,fp1\nfmove.l #$80,fpcr\nfmove.l #1,fp2\nfdiv.l #3,fp2')
		expect(raw(m, 1)).toBe(0x3ffdaaaaab0000000000n)
		expect(raw(m, 2)).toBe(0x3ffdaaaaaaaaaaaaa800n)
	})
	it('sets FPSR exception, accrued and condition bits', () => {
		let m = run('fmove.l #1,fp0\nfdiv.l #0,fp0')
		expect(fpsr(m)).toBe(CC_I | DZ | ADZ)
		m = run('fmove.l #0,fp0\nfdiv.x fp0,fp0')
		expect(fpsr(m)).toBe(CC_NAN | OPERR | IOP)
		expect(raw(m, 0)).toBe(0x7fffffffffffffffffffn)
		m = run('fmove.l #-2,fp0\nfmove.l #300,fp1\nfmove.b fp1,d0')
		expect(fpsr(m) & 0xffff).toBe(OPERR | IOP)
		expect(m.cpu.registers[0] & 255).toBe(0x7f)
		m = run('fmove.l #0,fp0\nfneg.x fp0')
		expect(fpsr(m)).toBe(CC_Z | CC_N)
		m = run('fmove.p data,fp0\nbkpt #0\n.data\ndata: dc.l $00010001,$23000000,0')
		expect(value(m, 0)).toBeCloseTo(12.3, 14)
		expect(fpsr(m) & 0xffff).toBe(INEX1 | AINEX)
	})
	it('faults atomically when an enabled exception occurs', () => {
		const m = runtime('fmove.l #$2000,fpcr\nfmove.l #0,fp0\nfdiv.x fp0,fp0')
		m.step()
		m.step()
		const before = m.registerValues()
		expect(() => m.step()).toThrow('OPERR')
		expect(m.registerValues()).toEqual(before)
	})
	it('evaluates IEEE-aware predicates with NaN and signals BSUN only for nonaware ones', () => {
		const m = run(
			'fmove.l #0,fp0\nfdiv.x fp0,fp0\nfmove.l #1,fp1\nfmove.l #0,fpsr\nfcmp.x fp1,fp0\n' +
				'fseq d0\nfsne d1\nfsun d2\nfsogt d3\nfsugt d4\nfsor d5\nfmove.l fpsr,d6\nfsgt d7\nfmove.l fpsr,d3'
		)
		const byte = (n: number) => m.cpu.registers[n] & 255
		expect([byte(0), byte(1), byte(2), byte(4), byte(5), byte(7)]).toEqual([0, 255, 255, 255, 0, 0])
		expect(m.cpu.registers[6] & (CC_NAN | BSUN)).toBe(CC_NAN)
		expect(m.cpu.registers[3] & (BSUN | IOP)).toBe(BSUN | IOP)
		const o = run('fmove.l #1,fp0\nfcmp.l #2,fp0\nfsolt d0\nfsogt d1\nfslt d2\nfsule d3\nfmove.l fpsr,d4')
		expect([0, 1, 2, 3].map((n) => o.cpu.registers[n] & 255)).toEqual([255, 0, 255, 255])
		expect(o.cpu.registers[4] & (CC_N | BSUN)).toBe(CC_N)
	})
	it('branches with FBcc and FDBcc', () => {
		const m = run('moveq #4,d0\nmoveq #0,d1\nfmove.l #3,fp0\nloop: addq.l #1,d1\nfsub.l #1,fp0\nfdbeq d0,loop\nftst.x fp0\nfbeq zero\nmoveq #-1,d1\nzero: nop')
		expect(m.cpu.registers[1]).toBe(3)
		expect(m.cpu.registers[0] & 65535).toBe(2)
	})
	it('loads FMOVECR constants correctly rounded', () => {
		const m = run('fmovecr #$00,fp0\nfmovecr #$30,fp1\nfmovecr #$0d,fp2\nfmovecr #$0b,fp3\nfmovecr #$0c,fp4\nfmovecr #$37,fp5\nfmovecr #$0f,fp6\nfmovecr #$31,fp7')
		// pi, ln 2, log2 e and log10 2 match the x87 FLDPI/FLDLN2/FLDL2E/FLDLG2 round-to-nearest constants.
		expect([0, 1, 2, 3].map((n) => raw(m, n))).toEqual([0x4000c90fdaa22168c235n, 0x3ffeb17217f7d1cf79acn, 0x3fffb8aa3b295c17f0bcn, 0x3ffd9a209a84fbcff799n])
		expect(raw(m, 4)).toBe(0x4000adf85458a2bb4a9bn)
		// 10^16 = $2386F26FC10000 exactly.
		expect(raw(m, 5)).toBe(0x40348e1bc9bf04000000n)
		expect(raw(m, 6)).toBe(0n)
		expect(value(m, 7)).toBe(Math.LN10)
		const exact = run('fmovecr #$37,fp0')
		expect(fpsr(exact) & 0xffff).toBe(0)
		expect(() => run('fmovecr #$01,fp0')).toThrow('FMOVECR')
	})
	it('computes FMOD, FREM, FINT, FGETEXP, FGETMAN and FSCALE', () => {
		const m = run('fmove.l #7,fp0\nfmod.l #2,fp0\nfmove.l fpsr,d0\nfmove.l #7,fp1\nfrem.l #2,fp1\nfmove.l fpsr,d1\n' +
			'fmove.d #2.5,fp2\nfint.x fp2\nfmove.d #-2.7,fp3\nfintrz.x fp3\nfmove.l #10,fp4\nfgetexp.x fp4,fp5\nfgetman.x fp4\nfmove.d #1.5,fp6\nfscale.l #4,fp6')
		expect([value(m, 0), value(m, 1), value(m, 2), value(m, 3), value(m, 5), value(m, 4), value(m, 6)]).toEqual([1, -1, 2, -2, 3, 1.25, 24])
		expect((m.cpu.registers[0] >> 16) & 0xff).toBe(3)
		expect((m.cpu.registers[1] >> 16) & 0xff).toBe(4)
		const n = run('fmove.l #-7,fp0\nfmod.l #2,fp0')
		expect([value(n, 0), (fpsr(n) >> 16) & 0xff]).toEqual([-1, 0x83])
	})
	it.each([
		['fsin', Math.sin], ['fcos', Math.cos], ['ftan', Math.tan], ['fasin', Math.asin], ['facos', Math.acos],
		['fatan', Math.atan], ['fsinh', Math.sinh], ['fcosh', Math.cosh], ['ftanh', Math.tanh], ['fatanh', Math.atanh],
		['fetox', Math.exp], ['fetoxm1', Math.expm1], ['ftwotox', (x: number) => 2 ** x], ['ftentox', (x: number) => 10 ** x],
		['flogn', Math.log], ['flognp1', Math.log1p], ['flog10', Math.log10], ['flog2', Math.log2]
	] as const)('%s is within two double ulps', (name, f) => {
		const m = run(`fmove.d #0.375,fp0\n${name}.x fp0,fp1`)
		expect(Math.abs(value(m, 1) - f(0.375))).toBeLessThanOrEqual(Math.abs(f(0.375)) * 2 ** -51)
		expect(fpsr(m) & INEX2).toBe(INEX2)
	})
	it('handles transcendental special cases and extended range', () => {
		let m = run('fmove.l #3,fp0\nfsincos.x fp0,fp1:fp2\nfmove.l #8,fp3\nflog2.x fp3\nfmove.l #2,fp4\nftentox.x fp4')
		expect([value(m, 1), value(m, 2)]).toEqual([Math.cos(3), Math.sin(3)])
		expect([value(m, 3), value(m, 4)]).toEqual([3, 100])
		m = run('fmove.l #0,fp0\nflogn.x fp0')
		expect(fpsr(m) & 0xffff).toBe(DZ | ADZ)
		expect(value(m, 0)).toBe(-Infinity)
		m = run('fmove.l #2,fp0\nfasin.x fp0')
		expect(fpsr(m) & 0xffff).toBe(OPERR | IOP)
		// e^1000 = 2^1442.695...: beyond double, within extended.
		m = run('fmove.l #1000,fp0\nfetox.x fp0\nflogn.x fp0,fp1')
		expect(Number(raw(m, 0) >> 64n)).toBe(0x3fff + 1442)
		expect(value(m, 1)).toBeCloseTo(1000, 10)
	})
	it('converts single, double, extended, integer and packed formats exactly', () => {
		const m = run(
			'lea data,a0\nfmove.x (a0),fp0\nfmove.x fp0,12(a0)\nfmove.s #-0.1,fp1\nfmove.s fp1,24(a0)\nfmove.d fp1,28(a0)\n' +
				'fmove.p 36(a0),fp2\nfmove.p fp2,48(a0){#17}\nfmovecr #0,fp3\nfmove.p fp3,60(a0){#5}\nfmove.d #2.5,fp4\nfmove.w fp4,d1\nfmove.l #$30,fpcr\nfmove.w fp4,d2\nbkpt #0\n' +
				'.data\ndata: dc.l $3fff0000,$80000000,1\nds.b 12\nds.b 12\ndc.l $00020001,$50000000,0\nds.b 24'
		)
		const longs = (address: number, count: number) => Array.from({ length: count }, (_, i) => m.cpu.view.getUint32(0x10000 + address + i * 4))
		// 1 + 2^-63 survives the extended round trip; doubles cannot hold it.
		expect(longs(0, 3)).toEqual([0x3fff0000, 0x80000000, 1])
		expect(longs(12, 3)).toEqual([0x3fff0000, 0x80000000, 1])
		expect(longs(24, 1)).toEqual([0xbdcccccd])
		expect(longs(28, 2)).toEqual([0xbfb99999, 0xa0000000])
		expect(value(m, 2)).toBe(150)
		expect(longs(48, 3)).toEqual([0x00020001, 0x50000000, 0])
		expect(longs(60, 3)).toEqual([0x00000003, 0x14160000, 0])
		expect([m.cpu.registers[1], m.cpu.registers[2]]).toEqual([2, 3])
	})
	it('moves FP data and control registers with FMOVEM', () => {
		const m = run(
			'fmove.l #1,fp0\nfmove.l #2,fp1\nfmove.l #3,fp2\nmovea.l #$10100,a0\nfmovem.x fp0-fp2,-(a0)\nmovea.l a0,a1\nfmovem.x (a1)+,fp4-fp6\n' +
				'moveq #-32,d0\nmovea.l #$10200,a2\nfmovem.x d0,(a2)\nfmove.l #$30,fpcr\nfmovem.l fpcr/fpiar,-(a2)\nfmovem.l (a2),fpcr/fpiar\nmovea.l #$10300,a3\nmoveq #7,d1\nfmovem.x d1,-(a3)'
		)
		expect(m.cpu.registers[8]).toBe(0x10100 - 36)
		expect(m.cpu.registers[9]).toBe(0x10100)
		expect(Array.from({ length: 3 }, (_, i) => m.cpu.view.getUint32(0x100dc + i * 4))).toEqual([0x3fff0000, 0x80000000, 0])
		expect([value(m, 4), value(m, 5), value(m, 6)]).toEqual([1, 2, 3])
		expect(m.cpu.view.getUint32(0x10200 + 24)).toBe(0x40000000)
		expect(m.cpu.registers[10]).toBe(0x10200 - 8)
		expect(m.cpu.view.getUint32(0x10200 - 8)).toBe(0x30)
		// Dynamic predecrement list 7 selects FP0-FP2 (FP7 is bit 7).
		expect(m.cpu.registers[11]).toBe(0x10300 - 36)
		expect(m.cpu.view.getUint32(0x10300 - 36 + 4)).toBe(0x80000000)
	})
})

describe('MC68881/MC68882 debugger and examples', () => {
	it('starts with NaN registers and steps back to the exact FPU state', () => {
		const m = runtime(EXAMPLES_68020_FPU.floatingpoint.code),
			reset = m.registerValues(),
			words = Array.from(m.cpu.fp)
		expect(reset.FP0).toBe(0x7fffffffffffffffffffn)
		finish(m)
		const count = m.instructionCount
		while (m.stepBack()) {
			/* undo every instruction */
		}
		expect(m.registerValues()).toEqual(reset)
		expect(Array.from(m.cpu.fp)).toEqual(words)
		finish(m)
		expect(m.instructionCount).toBe(count)
		expect(m.console).toBe('45\n1414\n500\n')
	})
	it('records and rewinds FP register edits and shows them in history', () => {
		const m = runtime('fmove.l #3,fp1\nfadd.l #4,fp1\nbkpt #0')
		m.step()
		m.step()
		const entry = m.history.at(1)!
		expect(m.historyFormat.instruction(entry)).toBe('fadd.l #4,fp1')
		expect(m.historyFormat.effects(entry, true)).toEqual(expect.arrayContaining([expect.objectContaining({ register: 'FP1', text: '3' })]))
		expect(m.writeRegister('FP2', 0x3fff8000000000000000n)).toBe(true)
		expect(m.writeRegister('FPCR', 0x10)).toBe(true)
		expect([value(m, 2), m.registerValues().FPCR]).toEqual([1, 0x10])
		m.stepBack()
		m.stepBack()
		expect(m.registerValues().FP2).toBe(0x7fffffffffffffffffffn)
		m.stepBack()
		expect(value(m, 1)).toBe(3)
	})
	it('names every changed FP register in executed dependency metadata', () => {
		for (const key of ['floatingpoint', 'mandelbrot']) {
			const m = runtime(EXAMPLES_68020_FPU[key].code),
				instructions = m.toolConfig().instructions
			let info: ReturnType<typeof instructions.describe> | undefined
			m.observers.push({ onInstruction: (_address, decoded) => { info = instructions.describe(decoded) } })
			for (let step = 0; step < 400 && !m.halted; step++) {
				const before = m.registerValues()
				m.step()
				const after = m.registerValues()
				instructions.registerNames.forEach((name, resource) => {
					const id = name === 'CCR/SR' ? 'SR' : name
					if (before[id] !== after[id]) expect(info!.writes, `${key}/${step} ${name}`).toContain(resource)
				})
			}
		}
	})
	it('runs the floating-point example with checked output and memory', () => {
		const m = runtime(EXAMPLES_68020_FPU.floatingpoint.code)
		finish(m)
		expect(m.console).toBe('45\n1414\n500\n')
		expect(m.cpu.view.getFloat64(m.program.labels.get('result')!)).toBeCloseTo(500, 9)
		expect(m.registerValues().FP3).toBe(0x7fffffffffffffffffffn)
		expect(m.cpu.registers[1]).toBe(10)
	})
	it('draws the FPU Mandelbrot pixel for pixel like the MIPS single-precision port', () => {
		const palette = [0x000030, 0x00104a, 0x001f66, 0x003080, 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0,
			0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb, 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff, 0x000000]
		const m = runtime(EXAMPLES_68020_FPU.mandelbrot.code)
		finish(m, 400_000)
		const actual: number[] = [], expected: number[] = []
		for (let row = 0; row < 32; row++)
			for (let col = 0; col < 32; col++) {
				let x = 0, y = 0, iteration = 0
				for (; iteration < 16; iteration++) {
					const xx = Math.fround(x * x), yy = Math.fround(y * y)
					if (Math.fround(xx + yy) > 4) break
					y = Math.fround(Math.fround(Math.fround(x * y) * 2) - 1.25 + row * 2.5 / 32)
					x = Math.fround(Math.fround(xx - yy) - 2 + col * 2.5 / 32)
				}
				expected.push(palette[iteration])
				actual.push(m.cpu.view.getUint32(0x10000 + (row * 32 + col) * 4))
			}
		expect(actual).toEqual(expected)
		expect(m.console).toBe('')
	})
})
