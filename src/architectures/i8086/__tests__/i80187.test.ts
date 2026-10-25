import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TargetFields } from '../../../components/SettingsDialog'
import definition from '../index'
import { decode, encode, type CpuModel } from '../isa'
import { type ArchitectureServices, variantOf } from '../../contracts'
import { offeredOptions } from '../../../core/settings'
import { variantConfigurations } from '../../../core/variants'
import type { ConfiguredRuntime } from '../../../core/configuredRuntime'

const services: ArchitectureServices[] = []
const context = { address: 0x1000, value: Number }
function load(code: string, coprocessor = '80187', cpuModel: CpuModel = '80186') {
	const service = definition.createServices(), settings = { cpuModel, coprocessor }
	services.push(service)
	const program = service.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
	expect(program.diagnostics).toEqual([])
	const machine = service.createMachine(program, settings, { speed: null, historyLimit: 1000 }) as ConfiguredRuntime
	return machine
}
const run = (code: string, count: number, coprocessor = '80187') => { const machine = load(code, coprocessor); for (let i = 0; i < count; i++) machine.step(); return machine }
const status = (machine: ConfiguredRuntime) => Number(machine.registerValues().fsw)
const C0 = 0x100, C1 = 0x200, C2 = 0x400, C3 = 0x4000, IE = 1
afterEach(() => { for (const service of services.splice(0)) service.dispose() })

describe('80187 coprocessor selection', () => {
	const field = definition.settings.fields.find(f => f.key === 'coprocessor')!
	const labels = (cpuModel: string) => field.control.kind === 'choice' ? offeredOptions(field.control.options, { cpuModel, coprocessor: 'none' }).map(o => o.label) : []
	it.each(['8086', '8088'])('offers only the 8087 with the %s', model => {
		expect(labels(model)).toEqual(['None', 'Intel 8087'])
	})
	it.each(['80186', '80188'])('offers the 8087 through the 82188 and the 80187 with the %s', model => {
		expect(labels(model)).toEqual(['None', 'Intel 8087 (via 82188)', 'Intel 80187'])
	})
	it('enumerates no 8086/8088 + 80187 variant', () => {
		const combinations = variantConfigurations(definition.settings).map(s => `${s.cpuModel}+${s.coprocessor}`)
		expect(combinations.filter(c => c.endsWith('80187')).sort()).toEqual(['80186+80187', '80188+80187'])
		expect(combinations).toHaveLength(10)
	})
	it.each([['8088', false], ['80188', true]] as const)('lists the 80187 in the settings dialog for the %s: %s', (cpuModel, offered) => {
		const markup = renderToStaticMarkup(createElement(TargetFields, { schema: definition.settings, group: 'CPU', values: { cpuModel, coprocessor: 'none' }, onChange: () => {} }))
		expect(markup.includes('Intel 80187')).toBe(offered)
		expect(markup.includes('Intel 8087')).toBe(true)
	})
	it('falls back to no coprocessor for an 8088 + 80187 setting', () => {
		const variant = variantOf(definition, { cpuModel: '8088', coprocessor: '80187' })
		expect(variant.language).toBe('thrax-i8088')
		expect(variant.registers.some(r => r.id === 'st0')).toBe(false)
		expect(variantOf(definition, { cpuModel: '80188', coprocessor: '80187' }).language).toBe('thrax-i80188-80187')
	})
	it('offers the trigonometry example only with the 80187', () => {
		expect(variantOf(definition, { cpuModel: '80186', coprocessor: '80187' }).examples.trigonometry?.requirements).toEqual(['Intel 80187'])
		expect(variantOf(definition, { cpuModel: '80186', coprocessor: '8087' }).examples.trigonometry).toBeUndefined()
		expect(variantOf(definition, { cpuModel: '8086', coprocessor: '80187' }).examples.trigonometry).toBeUndefined()
	})
	it.each(['80186', '80188'] as const)('runs the trigonometry example on the %s', model => {
		const example = variantOf(definition, { cpuModel: model, coprocessor: '80187' }).examples.trigonometry
		const machine = load(example.code, '80187', model)
		for (let i = 0; !machine.halted && i < 100; i++) machine.step()
		expect(machine.halted).toBe(true); expect(machine.console).toBe('-5064 8623')
	})
})

describe('80187 encodings', () => {
	// 80387 Programmer's Reference opcode map; FSETPM is the 80287 DB E4.
	it.each([
		['fsin', [], [0xd9, 0xfe]], ['fcos', [], [0xd9, 0xff]], ['fsincos', [], [0xd9, 0xfb]], ['fprem1', [], [0xd9, 0xf5]],
		['fucom', [], [0xdd, 0xe1]], ['fucom', ['st(3)'], [0xdd, 0xe3]], ['fucom', ['st(0)', 'st(2)'], [0xdd, 0xe2]],
		['fucomp', ['st(1)'], [0xdd, 0xe9]], ['fucomp', ['st(5)'], [0xdd, 0xed]], ['fucompp', [], [0xda, 0xe9]], ['fsetpm', [], [0xdb, 0xe4]],
	] as const)('encodes %s %s against Intel bytes, and only for the 80187', (name, args, bytes) => {
		expect(encode(name, args, context, '80186', '80187')).toEqual(bytes)
		expect(() => encode(name, args, context, '80186', '8087')).toThrow(/80187/)
		expect(decode(Uint8Array.from(bytes), 0, undefined, '80186', '80187').text.replace(/ ST\(\d\)/, '')).toBe(name.toUpperCase())
		expect(() => decode(Uint8Array.from(bytes), 0, undefined, '80186', '8087')).toThrow()
	})
})

describe('80187 semantics', () => {
	it('initializes the 80387 control word and keeps register history', () => {
		const machine = run('fld1\nfsin', 2)
		expect(machine.registerValues()).toMatchObject({ fcw: 0x037f, ftw: 0x3fff })
		machine.stepBack(); expect(machine.registerValues().st0).toBe(0x3fff8000000000000000n)
		expect(variantOf(definition, { cpuModel: '80186', coprocessor: '80187' }).registers.find(r => r.id === 'st0')?.bank).toBe('80187')
	})
	it('computes FSIN, FCOS and FSINCOS to extended precision', () => {
		// Expected words: independent decimal evaluation, rounded to nearest extended.
		expect(run('fld1\nfsin', 2).registerValues().st0).toBe(0x3ffed76aa47848677021n)
		expect(run('fld1\nfcos', 2).registerValues().st0).toBe(0x3ffe8a51407da8345c92n)
		expect(run('fldpi\nfsin', 2).registerValues().st0).toBe(0xbfbeece675d1fc8f8cbbn)
		const machine = run('fild word [x]\nfsincos\n.data\nx: .word 100', 2)
		expect(machine.registerValues()).toMatchObject({ st0: 0x3ffedcc0edfb32fefb20n, st1: 0xbffe81a12dbc626dc038n })
		expect(status(machine) & (C2 | 0x3800)).toBe(0x3000)
	})
	it('leaves operands of 2^63 and beyond unreduced with C2 set', () => {
		const machine = run('fld1\nfsin', 1)
		machine.writeRegister('st0', 0x403e8000000000000000n) // 2^63
		machine.step()
		expect(machine.registerValues().st0).toBe(0x403e8000000000000000n)
		expect(status(machine) & C2).toBe(C2)
	})
	it('rounds the FPREM1 quotient to nearest where FPREM truncates', () => {
		const pair = (op: string, a: number, b: number, coprocessor = '80187') => run(`fild word [b]\nfild word [a]\n${op}\n.data\na: .word ${a}\nb: .word ${b}`, 3, coprocessor)
		expect(pair('fprem', 5, 3).registerValues().st0).toBe(0x40008000000000000000n) // 2
		const ieee = pair('fprem1', 5, 3)
		expect(ieee.registerValues().st0).toBe(0xbfff8000000000000000n) // -1, quotient 2
		expect(status(ieee) & (C0 | C1 | C2 | C3)).toBe(C3)
		expect(pair('fprem1', 3, 2).registerValues().st0).toBe(0xbfff8000000000000000n) // 1.5 ties to 2
		expect(pair('fprem1', 5, 2).registerValues().st0).toBe(0x3fff8000000000000000n) // 2.5 ties to 2
		expect(pair('fprem1', 100, 7).registerValues().st0).toBe(0x40008000000000000000n) // 14.29 -> 14
	})
	it('reduces by 2*pi with FPREM1 exactly', () => {
		const machine = run('fldpi\nfadd st(0), st(0)\nfild word [x]\nfprem1\n.data\nx: .word 100', 4)
		expect(machine.registerValues().st0).toBe(0xbffe87ed5110b4611a80n)
	})
	it('raises invalid for a quiet NaN in FCOM but not FUCOM', () => {
		const compare = (op: string) => run(`fld dword [nan]\nfld1\n${op}\n.data\nnan: .long 0x7fc00000`, 3)
		for (const op of ['fucom st(1)', 'fucomp st(1)', 'fucompp']) {
			const machine = compare(op)
			expect(status(machine) & (C0 | C2 | C3 | IE)).toBe(C0 | C2 | C3)
		}
		expect(status(compare('fcom st(1)')) & (C0 | C2 | C3 | IE)).toBe(C0 | C2 | C3 | IE)
		const signaling = run('fld1\nfld1\nfucom st(1)', 2)
		signaling.writeRegister('st1', 0x7fffa000000000000000n)
		signaling.step(); expect(status(signaling) & IE).toBe(IE)
		const popped = compare('fucompp')
		expect(Number(popped.registerValues().ftw)).toBe(0xffff)
	})
	it.each([['8087', C3], ['80187', 0]] as const)('compares +inf with -inf on the %s', (coprocessor, expected) => {
		// Default IC = 0 selects projective closure on the 8087; the 80187 is affine only.
		const machine = run('fld dword [negative]\nfld dword [positive]\nfcom st(1)\n.data\nnegative: .long 0xff800000\npositive: .long 0x7f800000', 3, coprocessor)
		expect(status(machine) & (C0 | C2 | C3)).toBe(expected)
	})
	it.each([['8087', 0x03ff, 0x037f], ['80187', 0x037f, 0x037f]] as const)('applies FENI/FDISI on the %s', (coprocessor, disabled, enabled) => {
		const machine = run('fldcw [control]\nfndisi\nfnstcw [disabled]\nfneni\nfnstcw [enabled]\n.data\ncontrol: .word 0x037f\ndisabled: .word 0\nenabled: .word 0', 5, coprocessor)
		expect(machine.inspectMemory().word(0x8002)).toBe(disabled)
		expect(machine.inspectMemory().word(0x8004)).toBe(enabled)
	})
	it('ignores FSETPM', () => {
		const machine = run('fld1\nfsetpm', 1)
		const before = machine.registerValues(); machine.step()
		expect(machine.registerValues()).toMatchObject({ st0: before.st0, fsw: before.fsw, fcw: before.fcw, ftw: before.ftw })
	})
})
