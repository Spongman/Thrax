import { afterEach, describe, expect, it } from 'vitest'
import definition from '../index'
import { decode, encode, type CpuModel } from '../isa'
import { type ArchitectureServices, variantOf } from '../../contracts'
import type { ConfiguredRuntime } from '../../../core/configuredRuntime'

const services: ArchitectureServices[] = []
const context = { address: 0x1000, value: Number }
function load(code: string, cpuModel: CpuModel = '80186', coprocessor = 'none') {
	const service = definition.createServices(), settings = { cpuModel, coprocessor }
	services.push(service)
	const program = service.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
	expect(program.diagnostics).toEqual([])
	const machine = service.createMachine(program, settings, { speed: null, historyLimit: 1000 }) as ConfiguredRuntime
	return { service, machine, program, settings }
}
const steps = (machine: ConfiguredRuntime, count: number) => { for (let i = 0; i < count; i++) machine.step() }
afterEach(() => { for (const service of services.splice(0)) service.dispose() })

describe('80186 and 80188 native extensions', () => {
	it('disassembles unsigned absolute offsets and signed disp8 without sign-extending twice', () => {
		expect(decode(Uint8Array.from([0x8b, 6, 0, 0x80]), 0).text).toBe('MOV AX, [0x8000]')
		expect(decode(Uint8Array.from([0x8b, 0x46, 0xff]), 0).text).toBe('MOV AX, [BP-1]')
	})
	it.each([
		['pusha', [], [0x60]], ['popa', [], [0x61]], ['leave', [], [0xc9]], ['enter', ['32', '2'], [0xc8, 32, 0, 2]],
		['push', ['0x1234'], [0x68, 0x34, 0x12]], ['imul', ['ax', 'bx', '-7'], [0x69, 0xc3, 0xf9, 0xff]],
		['shl', ['ax', '3'], [0xc1, 0xe0, 3]], ['bound', ['bx', '[4096]'], [0x62, 0x1e, 0, 0x10]],
	] as const)('encodes %s against independent Intel bytes', (name, operands, bytes) => {
		expect(encode(name, operands, context, '80186')).toEqual(bytes)
		expect(encode(name, operands, context, '80188')).toEqual(bytes)
		expect(() => encode(name, operands, context, '8086')).toThrow()
		expect(() => decode(Uint8Array.from(bytes), 0)).toThrow()
	})
	it.each(['8086', '8088', '80186', '80188'] as const)('models PUSH SP and shift counts on %s', model => {
		const { machine } = load('mov sp,0x8000\npush sp\npop bx\nmov ax,1\nmov cl,33\nshl ax,cl', model)
		steps(machine, 6)
		expect(machine.registerValues()).toMatchObject({ bx: model.startsWith('801') ? 0x8000 : 0x7ffe, ax: model.startsWith('801') ? 2 : 0 })
	})
	it('preserves original SP in PUSHA and skips it in POPA', () => {
		const { machine } = load('mov sp,0x8000\nmov ax,7\nmov bx,9\npusha\nmov ax,99\nmov bx,88\npopa')
		steps(machine, 4)
		expect(machine.inspectMemory().word(0x7ff6)).toBe(0x8000)
		steps(machine, 3); expect(machine.registerValues()).toMatchObject({ ax: 7, bx: 9, sp: 0x8000 })
		machine.stepBack(); expect(machine.registerValues()).toMatchObject({ ax: 99, bx: 88, sp: 0x7ff0 })
	})
	it('builds and releases nested ENTER frames with native eight-bit levels', () => {
		const { machine } = load('mov sp,0x8000\nmov bp,0x8100\nenter 6,2\nleave')
		machine.writeByte(0x80fe, 0x34); machine.writeByte(0x80ff, 0x12)
		steps(machine, 3); expect(machine.registerValues()).toMatchObject({ bp: 0x7ffe, sp: 0x7ff4 })
		expect(machine.inspectMemory().word(0x7ffc)).toBe(0x1234)
		expect(machine.inspectMemory().word(0x7ffa)).toBe(0x7ffe)
		machine.step(); expect(machine.registerValues()).toMatchObject({ bp: 0x8100, sp: 0x8000 })
	})
	it('sign-extends immediate byte forms and reports IMUL truncation', () => {
		const { machine } = load('nop\n.byte 0x6a,0xff\npop bx\nmov ax,300\n.byte 0x6b,0xc0,0xfe\nimul dx,ax,100')
		steps(machine, 5); expect(machine.registerValues()).toMatchObject({ bx: 65535, ax: 64936 })
		machine.step(); expect(Number(machine.registerValues().flags) & 0x801).toBe(0x801)
	})
	it.each(['8086', '80186'] as const)('uses the %s segment-end word transfer behavior', model => {
		const { machine } = load('mov ax,0x1000\nmov ds,ax\nmov word [0xffff],0x1234', model)
		steps(machine, 3)
		expect(machine.inspectMemory().byte(0x1ffff)).toBe(0x34)
		expect(machine.inspectMemory().byte(model === '80186' ? 0x20000 : 0x10000)).toBe(0x12)
		machine.stepBack(); expect(machine.inspectMemory().byte(0x1ffff)).toBe(0)
	})
	it('takes the original BOUND trap with a return IP following the instruction', () => {
		const { machine, program } = load('mov ax,5\nbound ax,[limits]\nhlt\nhandler: mov bx,77\niret\n.data\nlimits: .word -2,2')
		const handler = program.labels.get('handler')!
		machine.writeByte(20, handler & 255); machine.writeByte(21, handler >>> 8)
		steps(machine, 2); expect(machine.pc).toBe(handler)
		expect(machine.inspectMemory().word(0xfff8)).toBe(0x1007)
		steps(machine, 2); expect(machine.pc).toBe(0x1007); expect(machine.registerValues().bx).toBe(77)
	})
	it('keeps a far pointer physically contiguous across the 80186 segment boundary', () => {
		const { machine } = load('mov bx,0x1000\nmov ds,bx\nles ax,[0xffff]')
		for (const [offset, value] of [0x34, 0x12, 0x78, 0x56].entries()) machine.writeByte(0x1ffff + offset, value)
		steps(machine, 3)
		expect(machine.registerValues()).toMatchObject({ ax: 0x1234, es: 0x5678 })
	})
	it.each(['8086', '80186'] as const)('uses the native %s signed division range with atomic faults', model => {
		const { machine } = load('mov ax,0x8000\ncwd\nmov bx,1\nidiv bx', model)
		steps(machine, 3)
		if (model === '80186') { machine.step(); expect(machine.registerValues()).toMatchObject({ ax: 0x8000, dx: 0 }) }
		else { const before = machine.registerValues(); expect(() => machine.step()).toThrow(/division overflow/); expect(machine.registerValues()).toEqual(before) }
	})
})

describe('optional 8087', () => {
	it.each([
		['fninit', [], [0xdb, 0xe3]], ['finit', [], [0x9b, 0xdb, 0xe3]], ['fld1', [], [0xd9, 0xe8]],
		['fld', ['st(3)'], [0xd9, 0xc3]], ['fxch', ['st(2)'], [0xd9, 0xca]],
		['fadd', ['st(0)', 'st(2)'], [0xd8, 0xc2]], ['fsub', ['st(2)', 'st(0)'], [0xdc, 0xea]],
		['fdivp', ['st(1)', 'st(0)'], [0xde, 0xf9]], ['fcompp', [], [0xde, 0xd9]],
		['fcomp', ['st(3)'], [0xd8, 0xdb]], ['fcom', [], [0xd8, 0xd1]],
		['fld', ['dword [0x8000]'], [0xd9, 6, 0, 0x80]], ['fild', ['qword [0x8000]'], [0xdf, 0x2e, 0, 0x80]],
		['fstp', ['tword [0x8000]'], [0xdb, 0x3e, 0, 0x80]], ['fnstsw', ['word [0x8000]'], [0xdd, 0x3e, 0, 0x80]],
	] as const)('encodes native %s independently of CPU choice', (name, args, bytes) => {
		expect(encode(name, args, context, '8086', '8087')).toEqual(bytes)
		expect(encode(name, args, context, '80186', '8087')).toEqual(bytes)
		expect(() => encode(name, args, context)).toThrow(/8087/)
	})
	it('exposes an add-on bank without changing the CPU selector, and replaces Mandelbrot', () => {
		expect(definition.settings.defaults).toEqual({ cpuModel: '8086', coprocessor: 'none' })
		const without = variantOf(definition, { cpuModel: '80186', coprocessor: 'none' }), withFpu = variantOf(definition, { cpuModel: '80186', coprocessor: '8087' })
		expect(without.registers.some(r => r.id === 'st0')).toBe(false)
		expect(withFpu.registers.find(r => r.id === 'st0')?.bits).toBe(80)
		expect(withFpu.examples.mandelbrot.code).not.toBe(without.examples.mandelbrot.code)
		expect(withFpu.examples.mandelbrot.tools).toEqual(without.examples.mandelbrot.tools)
	})
	it('keeps extended precision beyond binary64, memory stores, edits and history exact', () => {
		const { machine } = load('fild qword [integer]\nfld1\nfaddp\nfistp qword [answer]\nhlt\n.data\ninteger: .quad 9007199254740993\nanswer: .quad 0', '8086', '8087')
		machine.step(); expect(machine.registerValues().st0).toBe(0x40348000000000000400n)
		const row = machine.history.at(0)!
		expect(machine.historyFormat.effects(row, true).some(e => e.register === 'st0' && e.value === 0n)).toBe(true)
		steps(machine, 3)
		expect(machine.readWide(0x8008, true)).toBe(9007199254740994n)
		machine.stepBack(); expect(machine.readWide(0x8008, true)).toBe(0n)
		machine.stepBack(); expect(machine.registerValues().st0).toBe(0x3fff8000000000000000n)
		machine.step(); machine.step(); expect(machine.readWide(0x8008, true)).toBe(9007199254740994n)
		expect(machine.writeRegister('st0', 0xbfff8000000000000000n)).toBe(true)
		expect(machine.registerValues().st0).toBe(0xbfff8000000000000000n)
		machine.stepBack(); expect(machine.registerValues().st0).not.toBe(0xbfff8000000000000000n)
	})
	it('applies directed integer rounding and preserves signed zero', () => {
		const { machine } = load('fldcw [control]\nfld dword [half]\nfistp word [answer]\nfldz\nfchs\nfstp tword [zero]\n.data\ncontrol: .word 0x0bff\nhalf: .long 0x3f000000\nanswer: .word 0\nzero: .space 10', '80188', '8087')
		steps(machine, 6)
		expect(machine.inspectMemory().word(0x8006)).toBe(1)
		expect(machine.inspectMemory().word(0x8010)).toBe(0x8000)
		expect(Number(machine.registerValues().fsw) & 32).toBe(32)
	})
	it('tracks TOP, tags and comparison status without changing integer FLAGS', () => {
		const { machine } = load('fld1\nfldz\nfcom st(1)\nfnstsw [answer]\n.data\nanswer: .word 0', '8086', '8087')
		steps(machine, 4)
		expect(machine.inspectMemory().word(0x8000)! & 0x4500).toBe(0x100)
		expect(machine.registerValues()).toMatchObject({ flags: 0xf002, ftw: 0x1fff })
	})
	it('retains unmasked exceptions until a wait, without committing the arithmetic result', () => {
		const { machine } = load('fldcw [control]\nfld1\nfldz\nfdivp st(1),st(0)\nwait\n.data\ncontrol: .word 0x03fb', '8086', '8087')
		steps(machine, 4)
		expect(Number(machine.registerValues().fsw) & 0x84).toBe(0x84)
		expect(Number(machine.registerValues().fsw) & 0x3800).toBe(0x3000)
		expect(() => machine.step()).toThrow(/pending unmasked/)
		machine.stepBack(); expect(Number(machine.registerValues().fsw) & 0x84).toBe(0)
	})
	it('saves/restores the native 94-byte image and resets after save', () => {
		const { machine } = load('fld1\nfldpi\nfnsave [image]\nfrstor [image]\n.data\nimage: .space 94', '8086', '8087')
		steps(machine, 2); const before = machine.registerValues()
		machine.step(); expect(machine.registerValues()).toMatchObject({ fsw: 0, ftw: 0xffff, fcw: 0x03ff })
		machine.step(); expect(machine.registerValues()).toMatchObject({ st0: before.st0, st1: before.st1, fsw: before.fsw, ftw: before.ftw })
	})
	it.each(['8086', '8088', '80186', '80188'] as const)('runs the dedicated FPU example on %s and preserves baseline example selection', model => {
		const example = variantOf(definition, { cpuModel: model, coprocessor: '8087' }).examples.floatingpoint
		const { machine } = load(example.code, model, '8087')
		for (let i = 0; !machine.halted && i < 100; i++) machine.step()
		expect(machine.halted).toBe(true); expect(machine.console).toBe('45')
	})
	it('honors PC precision independently of exact integer loads', () => {
		const { machine } = load('fldcw [control]\nfild dword [integer]\nfld1\nfaddp\nfistp dword [answer]\n.data\ncontrol: .word 0x00ff\ninteger: .long 16777216\nanswer: .long 0', '8086', '8087')
		steps(machine, 5)
		expect(machine.read(0x8006, 4, true)).toBe(16777216)
		expect(Number(machine.registerValues().fsw) & 32).toBe(32)
	})
	it('scales at extended precision even when arithmetic PC is single precision', () => {
		const { machine } = load('fldcw [control]\nfldz\nfild qword [integer]\nfscale\n.data\ncontrol: .word 0x00ff\ninteger: .quad 9007199254740993', '8086', '8087')
		steps(machine, 4)
		expect(machine.registerValues().st0).toBe(0x40348000000000000400n)
		expect(Number(machine.registerValues().fsw) & 32).toBe(0)
	})
	it('tracks stack overflow and masked invalid conversion instead of silently overwriting valid data', () => {
		const { machine } = load(`${Array(9).fill('fld1').join('\n')}\nfistp word [answer]\n.data\nanswer: .word 0`, '8086', '8087')
		steps(machine, 9)
		expect(Number(machine.registerValues().fsw) & 0x201).toBe(0x201)
		machine.step(); expect(machine.inspectMemory().word(0x8000)).toBe(0x8000)
	})
	it('performs partial remainder reduction and reports completed quotient bits', () => {
		const { machine } = load('fld1\nfld1\nfprem\nfprem\nfprem', '8086', '8087')
		steps(machine, 2)
		machine.writeRegister('st0', 0x40638000000000000000n) // 2^100
		machine.writeRegister('st1', 0x4000c000000000000000n) // 3
		machine.step(); expect(Number(machine.registerValues().fsw) & 0x400).toBe(0x400)
		steps(machine, 2); expect(Number(machine.registerValues().fsw) & 0x400).toBe(0)
		expect(machine.registerValues().st0).toBe(0x3fff8000000000000000n)
	})
	it('preserves signed packed decimal zero and all 18 digits', () => {
		const { machine } = load('fbld tword [decimal]\nfbstp tword [answer]\n.data\ndecimal: .byte 0x78,0x56,0x34,0x12,0x90,0x78,0x56,0x34,0x12,0x80\nanswer: .space 10', '8086', '8087')
		steps(machine, 2)
		expect(Array.from(machine.memory.subarray(0x800a, 0x8014))).toEqual(Array.from(machine.memory.subarray(0x8000, 0x800a)))
	})
	it('stores real-mode physical exception pointers and the native opcode in the environment', () => {
		const { machine } = load('fild word es:[0x8000]\nfnstenv [image]\n.data\n.word 7\nimage: .space 14', '8086', '8087')
		steps(machine, 2)
		expect(machine.inspectMemory().word(0x8008)).toBe(0x1000)
		expect(machine.inspectMemory().word(0x800a)).toBe(0x706) // DF /0 direct-memory ModRM
		expect(machine.inspectMemory().word(0x800c)).toBe(0x8000)
	})
})
