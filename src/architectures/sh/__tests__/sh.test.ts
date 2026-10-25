import { afterEach, describe, expect, it } from 'vitest'
import definition from '../index'
import { decode, encode } from '../isa'
import type { ArchitectureServices } from '../../contracts'
import { ConfiguredRuntime } from '../../../core/configuredRuntime'

const services: ArchitectureServices[] = []
function load(code: string, model = 'sh2') {
	const service = definition.createServices(), settings = { cpuModel: model }
	services.push(service)
	const program = service.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
	expect(program.diagnostics).toEqual([])
	const machine = service.createMachine(program, settings, { speed: null, historyLimit: 100000 }) as ConfiguredRuntime
	return { machine, program, service }
}
const steps = (m: ConfiguredRuntime, count: number) => { for (let i = 0; i < count; i++) m.step() }
afterEach(() => { for (const s of services.splice(0)) s.dispose() })

describe('SuperH native encodings', () => {
	it.each([
		['nop', [], 0x0009], ['rts', [], 0x000b], ['mov', ['#-1', 'r4'], 0xe4ff], ['mov', ['r2', 'r3'], 0x6323],
		['add', ['r2', 'r3'], 0x332c], ['addc', ['r2', 'r3'], 0x332e], ['cmp/ge', ['r2', 'r3'], 0x3323],
		['mov.l', ['r4', '@-r15'], 0x2f46], ['mov.l', ['@r15+', 'r4'], 0x64f6], ['mov.b', ['r0', '@(3,r8)'], 0x8083],
		['mov.l', ['@(r0,r9)', 'r14'], 0x0e9e], ['mov.w', ['@(6,pc)', 'r2'], 0x9203],
		['bsr', ['4104'], 0xb002], ['bf/s', ['4096'], 0x8ffe], ['jsr', ['@r2'], 0x420b],
		['sts.l', ['pr', '@-r15'], 0x4f22], ['lds.l', ['@r15+', 'pr'], 0x4f26],
		['stc', ['sr', 'r3'], 0x0302], ['ldc', ['r3', 'gbr'], 0x431e], ['mac.l', ['@r2+', '@r3+'], 0x032f],
		['dmuls.l', ['r2', 'r3'], 0x332d], ['trapa', ['#0x10'], 0xc310],
	] as const)('encodes %s against independent manual words', (n, args, expected) => {
		expect(encode(n, args, { address: 0x1000, value: Number })).toEqual([expected >>> 8, expected & 255])
		expect(decode(new Uint8Array([expected >>> 8, expected & 255]), 0).text.split(/\s/)[0]).toBe(n)
	})
	it('enforces SH-1 instruction restrictions in assembler and native decoder', () => {
		for (const [n, args, w] of [['mul.l', ['r1', 'r2'], 0x0217], ['dt', ['r1'], 0x4110], ['bt/s', ['4100'], 0x8d00], ['mac.l', ['@r1+', '@r2+'], 0x021f]] as const) {
			expect(() => encode(n, args, { address: 0x1000, value: Number }, 'sh1')).toThrow(/Unsupported/)
			expect(() => decode(new Uint8Array([w >>> 8, w & 255]), 0, 'sh1'), n).toThrow(/unavailable/)
		}
	})
	it('rejects invalid fields, native widths and operand classes', () => {
		for (const [n, args] of [['mov', ['#128', 'r1']], ['mov', ['r16', 'r1']], ['and', ['#1', 'r1']], ['bra', ['4097']], ['mov.l', ['@(3,r1)', 'r2']], ['ldc', ['r1', 'pr']], ['sts.l', ['pr', '@r15+']]] as const) expect(() => encode(n, args, { address: 0x1000, value: Number })).toThrow()
		expect(() => decode(new Uint8Array([0xff, 0xff]), 0)).toThrow(/Illegal/)
	})
})

describe.each(['sh1', 'sh2'])('%s functional semantics', model => {
	it.each([0, 127, 128, 255, 256, 0x12345678, 0x80808080, 0xffffffff, -1, -2147483648])('expands arbitrary constant %i to seven native instructions', value => {
		const { machine, program } = load(`mov32 #${value},r4\nnop`, model)
		steps(machine, 7)
		expect(machine.registerValues().r4).toBe(value >>> 0)
		expect(machine.pc).toBe(0x100e)
		expect(new Map(program.sourceIndex.lines('main.asm')).get(1)).toHaveLength(7)
	})
	it('links PC+4 and returns after the slot, preserving latched targets across edits and rewind', async () => {
		const { machine } = load('bsr fn\nmov #7,r4\nnop\nfn: rts\nadd #1,r4', model)
		machine.step(); expect(machine.pc).toBe(0x1002); expect(machine.registerValues().pr).toBe(0x1004)
		machine.step(); expect(machine.pc).toBe(0x1006)
		machine.step(); expect(machine.callStack).toHaveLength(1)
		const state = machine.state.slice()
		machine.step(); expect(machine.pc).toBe(0x1004); expect(machine.registerValues().r4).toBe(8); expect(machine.callStack).toEqual([])
		machine.stepBack(); expect(machine.state).toEqual(state); expect(machine.callStack).toHaveLength(1)
		machine.step(); expect(machine.callStack).toEqual([])
		const second = load('bsr fn\nmov #7,r4\nnop\nfn: rts\nadd #1,r4', model).machine
		await second.stepOver(); expect(second.pc).toBe(0x1004); expect(second.registerValues().r4).toBe(8)
	})
	it('sign-extends byte/word loads and suppresses same-register post increment', () => {
		const { machine } = load('mov32 #data,r1\nmov.b @r1,r2\nmov.w @r1,r3\nmov.l @r1+,r1\n.data\ndata: .long 0x80ff1234', model)
		steps(machine, 10)
		expect(machine.registerValues()).toMatchObject({ r1: 0x80ff1234, r2: 0xffffff80, r3: 0xffff80ff })
	})
	it('models carry/borrow and signed overflow independently', () => {
		const { machine } = load('mov #-1,r1\nmov #0,r2\nsett\naddc r1,r2\nmov #0,r2\nsubc r2,r2\nmov32 #0x7fffffff,r1\nmov #1,r2\naddv r2,r1', model)
		steps(machine, 4); expect(machine.registerValues()).toMatchObject({ r2: 0, sr: 1 })
		steps(machine, 2); expect(machine.registerValues()).toMatchObject({ r2: 0xffffffff, sr: 1 })
		steps(machine, 9); expect(machine.registerValues()).toMatchObject({ r1: 0x80000000, sr: 1 })
	})
	it('implements native stepwise unsigned division rather than host quotient shortcuts', () => {
		const divide16 = load(['mov #100,r1', 'mov #7,r2', 'shll16 r2', 'div0u', ...Array.from({ length: 16 }, () => 'div1 r2,r1'), 'rotcl r1', 'extu.w r1,r1'].join('\n'), model).machine
		steps(divide16, 22); expect(divide16.registerValues().r1).toBe(14)
	})
	it('uses native MACH width and exact multiply-accumulate with atomic pointer rollback', () => {
		const { machine } = load('mov #-1,r1\nlds r1,mach\nsts mach,r2\nmov32 #data,r3\nmov r3,r4\nclrmac\nmac.w @r3+,@r4+\n.data\ndata: .word 0x8000,2', model)
		steps(machine, 3); expect(machine.registerValues().r2).toBe(0xffffffff)
		steps(machine, 10); expect(machine.registerValues()).toMatchObject({ macl: 0x40000000, mach: 0, r3: 0x10002, r4: 0x10002 })
		machine.stepBack(); expect(machine.registerValues()).toMatchObject({ macl: 0, mach: 0, r3: 0x10000, r4: 0x10000 })
		machine.writeRegister('mach', 0x200); expect(machine.registerValues().mach).toBe(model === 'sh1' ? 0xfffffe00 : 0x200)
	})
	it.each([false, true])('saturates word accumulation with native MACH behavior, negative=%s', negative => {
		const { machine } = load('mac.w @r1+,@r2+\n.data\n.word 1,0xffff', model)
		machine.writeRegister('r1', 0x10000)
		machine.writeRegister('r2', negative ? 0x10002 : 0x10000)
		machine.writeRegister('sr', 2)
		machine.writeRegister('mach', 0x100)
		machine.writeRegister('macl', negative ? 0x80000000 : 0x7fffffff)
		machine.step()
		expect(machine.registerValues()).toMatchObject({ mach: model === 'sh1' ? 0x101 : 0x100, macl: negative ? 0x80000000 : 0x7fffffff })
		machine.stepBack()
		expect(machine.registerValues()).toMatchObject({ mach: 0x100, r1: 0x10000, r2: negative ? 0x10002 : 0x10000 })
	})
	it('rolls back misaligned accesses and slot-illegal transfers without partial retirement', () => {
		for (const code of ['mov #1,r1\nmov.l @r1,r2', 'bra next\nbra next\nnext: nop']) {
			const { machine } = load(code, model); machine.step()
			const before = machine.registerValues(), state = machine.state.slice()
			expect(() => machine.step()).toThrow()
			expect(machine.registerValues()).toEqual(before); expect(machine.state).toEqual(state); expect(machine.instructionCount).toBe(1)
		}
	})
})

describe('SH-2 extra operations', () => {
	it.each([
		[0x12340000, 0, 1, 1, 0, 1],
		[0x7fff, 0xffffffff, 1, 1, 0x7fff, 0xffffffff],
		[0, 0, 0x80000000, 0x7fffffff, 0x8000, 0],
		[0, 0, 0xffffffff, 1, 0xffffffff, 0xffffffff],
	])('uses native 48-bit MAC.L saturation for MACH=%i MACL=%i operands=%i,%i', (mach, macl, left, right, expectedHigh, expectedLow) => {
		const { machine } = load(`mac.l @r1+,@r2+\n.data\n.long ${left},${right}`)
		for (const [name, value] of Object.entries({ r1: 0x10000, r2: 0x10004, sr: 2, mach, macl })) machine.writeRegister(name, value)
		machine.step()
		expect(machine.registerValues()).toMatchObject({ mach: expectedHigh, macl: expectedLow, r1: 0x10004, r2: 0x10008 })
		machine.stepBack()
		expect(machine.registerValues()).toMatchObject({ mach, macl, r1: 0x10000, r2: 0x10004 })
	})
	it('uses the branch destination PC base for a PC-relative delay load', () => {
		const { machine } = load('bra next\nmov.w @(0,pc),r1\n.word 0\nnext: nop\n.word 0x8123')
		steps(machine, 2); expect(machine.pc).toBe(0x1006); expect(machine.registerValues().r1).toBe(0xffff8123)
	})
	it.each([false, true])('latches BT/S condition with initial T=%s', taken => {
		const { machine } = load(`${taken ? 'sett' : 'clrt'}\nbt/s next\nclrt\nnop\nnext: nop`)
		steps(machine, 3); expect(machine.pc).toBe(taken ? 0x1008 : 0x1006); expect(machine.registerValues().sr).toBe(0)
	})
	it('keeps exact signed and unsigned double products', () => {
		const { machine } = load('mov #-1,r1\ndmulu.l r1,r1\ndmuls.l r1,r1')
		steps(machine, 2); expect(machine.registerValues()).toMatchObject({ mach: 0xfffffffe, macl: 1 })
		machine.step(); expect(machine.registerValues()).toMatchObject({ mach: 0, macl: 1 })
	})
})
