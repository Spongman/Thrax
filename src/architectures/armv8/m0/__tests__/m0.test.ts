import { describe, expect, it } from 'vitest'
import { codeRowOf } from '../../../../core/sourceIndex'
import definition from '../../index'
import { DEFAULT_ARMV8_SETTINGS } from '../../settings'
import { assembleM0 } from '../assembler'
import { decode, TEXT_BASE } from '../isa'
import { disassembly } from '../program'
import { M0Runtime } from '../runtime'
import { EXAMPLES } from '../examples'

const settings = { ...DEFAULT_ARMV8_SETTINGS, executionState: 'cortex-m0' }
function assemble(code: string) {
	return assembleM0({ files: [{ name: 'main.s', code }], entries: ['main.s'] }, 1 << 20)
}
function machine(code: string, limit = 100000) {
	const p = assemble(code)
	expect(p.diagnostics).toEqual([])
	return new M0Runtime(p, 1 << 20, { speed: null, historyLimit: limit })
}
function finish(m: M0Runtime) {
	let n = 0
	while (!m.halted && !m.pendingInput && n++ < 250000) m.step()
	expect(n).toBeLessThan(250000)
}
function words(code: string) {
	const p = assemble(code)
	expect(p.diagnostics).toEqual([])
	const s = p.image().sections[0].bytes
	return Array.from({ length: s.length / 2 }, (_, n) => s[n * 2] | (s[n * 2 + 1] << 8))
}

describe('ARMv6-M Thumb', () => {
	it('matches independent Arm encoding bit patterns', () => {
		expect(
			words(
				'movs r0,#42\nadds r1,r0,#3\nsubs r2,r1,r0\nlsls r3,r2,#5\nadcs r0,r1\nldr r0,[r1,#4]\nstrh r2,[r3,#6]\npush {r4,lr}\npop {r4,pc}\nbx lr\nbkpt #0',
			),
		).toEqual([0x202a, 0x1cc1, 0x1a0a, 0x0153, 0x4148, 0x6848, 0x80da, 0xb510, 0xbd10, 0x4770, 0xbe00])
		expect(words('bl target\nnop\ntarget: bx lr')).toEqual([0xf000, 0xf801, 0xbf00, 0x4770])
		expect(words('mrs r0,primask\nmsr psp,r1\ndmb sy\ndsb sy\nisb sy')).toEqual([
			0xf3ef, 0x8010, 0xf381, 0x8809, 0xf3bf, 0x8f5f, 0xf3bf, 0x8f4f, 0xf3bf, 0x8f6f,
		])
	})
	it.each(Object.keys(EXAMPLES))('runs and fully rewinds the %s example', (key) => {
		const m = machine(EXAMPLES[key as keyof typeof EXAMPLES].code, key === 'mandelbrot' ? 250000 : 100000)
		finish(m)
		if (key === 'input') {
			expect(m.pendingInput?.type).toBe('integer')
			expect(m.provideInput('42')).toBe(true)
			finish(m)
		}
		const outputs: Record<string, string> = {
			hello: 'Hello, THRAX!\n',
			sum: '8',
			factorial: '120',
			fibonacci: '55',
			loop: '1\n2\n3\n4\n5\n',
			bitwise: '8\n14\n6',
			input: '42',
			bitmap: '',
			mandelbrot: '',
			ackermann: '61',
		}
		expect(m.console).toBe(outputs[key])
		expect(m.halted).toBe(true)
		if (['sum', 'factorial', 'fibonacci', 'input'].includes(key))
			expect(m.registerValues().R0).toBe(Number(outputs[key]))
		if (key === 'loop') expect(m.registerValues().R4).toBe(6)
		if (key === 'bitwise')
			expect([m.registerValues().R2, m.registerValues().R3, m.registerValues().R4]).toEqual([8, 14, 6])
		if (key === 'bitmap') {
			const pixels = m.program.labels.get('pixels')!
			for (const n of [0, 31, 32, 35, 1023])
				expect([0, 1, 2, 3].map((offset) => m.inspectMemory().byte(pixels + n * 4 + offset))).toEqual([
					(n % 32) << 3, 0, Math.floor(n / 32) << 3, 0,
				])
		}
		while (m.stepBack()) {
			/* restore all machine state */
		}
		expect(m.instructionCount).toBe(0)
		expect(m.pc).toBe(TEXT_BASE)
		expect(m.console).toBe('')
		expect(m.callStack).toEqual([])
		finish(m)
		if (key === 'input') {
			expect(m.provideInput('42')).toBe(true)
			finish(m)
		}
		expect(m.halted).toBe(true)
		expect(m.console).toBe(outputs[key])
	})
	it('implements carry/overflow/borrow and ARM shift edge cases', () => {
		const m = machine(
			'ldr r0,=0x7fffffff\nmovs r1,#1\nadds r0,r0,r1\nmrs r2,apsr\nmovs r0,#0\nsubs r0,#1\nmrs r3,apsr\nmovs r4,#32\nlsrs r0,r4\nmrs r5,apsr\nbkpt #0',
		)
		finish(m)
		expect(m.registerValues().R2).toBe(0x90000000)
		expect(m.registerValues().R3).toBe(0x80000000)
		expect(m.registerValues().R0).toBe(0)
		expect(m.registerValues().R5).toBe(0x60000000)
	})
	it('uses PC+4, literal alignment, Thumb link bit, and stack return semantics', () => {
		const m = machine('nop\nmov r0,pc\nbl f\nbkpt #0\nf: push {r4,lr}\nmov r4,lr\npop {r4,pc}')
		m.step()
		m.step()
		expect(m.registerValues().R0).toBe(TEXT_BASE + 6)
		m.step()
		expect(m.registerValues().R14).toBe(TEXT_BASE + 9)
		expect(m.callStack).toHaveLength(1)
		finish(m)
		expect(m.callStack).toEqual([])
		m.stepBack()
		m.stepBack()
		expect(m.callStack).toHaveLength(1)
	})
	it('faults misaligned data and non-Thumb exchange atomically and seeks tools', () => {
		const m = machine('ldr r0,=0x420001\nldr r1,[r0]\nbkpt #0')
		let seek = -1
		m.observers.push({
			onSeek: (n) => {
				seek = n
			},
		})
		m.step()
		expect(() => m.step()).toThrow('Unaligned')
		expect(m.instructionCount).toBe(1)
		expect(m.pc).toBe(TEXT_BASE + 2)
		expect(seek).toBe(1)
		const n = machine('ldr r0,=0x400000\nbx r0')
		n.step()
		expect(() => n.step()).toThrow('bit 0')
		expect(n.pc).toBe(TEXT_BASE + 2)
	})
	it('supports all load widths, sign extension, multiple transfers and byte reversals', () => {
		const m = machine(
			'ldr r0,=data\nmovs r1,#0\nldrsb r2,[r0,r1]\nldrh r3,[r0,#2]\nldrsh r4,[r0,r1]\nrev r5,r3\nrevsh r6,r3\nldmia r0!,{r1,r2}\nbkpt #0\n.data\n.balign 4\ndata: .word 0x123480fe,0x87654321',
		)
		finish(m)
		expect(m.registerValues().R4).toBe(0xffff80fe)
		expect(m.registerValues().R5).toBe(0x34120000)
		expect(m.registerValues().R6).toBe(0x3412)
		expect(m.registerValues().R1).toBe(0x123480fe)
		expect(m.registerValues().R2).toBe(0x87654321)
	})
	it('supports MSP/PSP/CONTROL/PRIMASK and restores them through history', () => {
		const m = machine(
			'ldr r0,=0x480003\nmsr psp,r0\nmovs r1,#2\nmsr control,r1\nisb sy\nmrs r2,psp\ncpsid i\nmrs r3,primask\nmovs r1,#0\nmsr control,r1\nbkpt #0',
		)
		finish(m)
		expect(m.registerValues().R2).toBe(0x480000)
		expect(m.registerValues().R3).toBe(1)
		expect(m.registerValues().R13).toBe(0x500000)
		while (m.stepBack()) {
			/* restore special registers */
		}
		expect(m.registerValues().CONTROL).toBe(0)
		expect(m.registerValues().PRIMASK).toBe(0)
	})
	it('uses explicit teaching input and rolls acceptance back', () => {
		const m = machine('svc #5\nsvc #1\nbkpt #0'),
			seen: number[] = []
		m.observers.push({ onInstruction: (_a, _i, n) => seen.push(n) })
		m.step()
		expect(m.pendingInput?.type).toBe('integer')
		expect(m.provideInput('42')).toBe(true)
		expect(seen).toEqual([0])
		m.stepBack()
		expect(m.pendingInput?.type).toBe('integer')
		m.provideInput('-9')
		finish(m)
		expect(m.console).toBe('-9')
	})
	it('bounds frame history and instruction history across blocks', () => {
		const m = machine('again: bl again', 10000)
		for (let n = 0; n < 3000; n++) m.step()
		expect(m.callStack).toHaveLength(3000)
		expect(m.history.log.payloadCount).toBe(0)
		while (m.stepBack()) {
			/* undo typed call deltas */
		}
		expect(m.callStack).toEqual([])
	})
	it('shares the source gutter conventional halfword order', () => {
		const m = machine('movs r0,#42\nbl target\nbkpt #0\ntarget: bx lr')
		const row = m.program.sourceIndex.rowsForLine('main.s', 2)[0]
		expect(disassembly.row(codeRowOf(row, m.inspectMemory()))).toBe('bl 0x400008')
	})
	it.each([
		'it eq',
		'cbz r0,0x400004',
		'movw r0,#1',
		'udiv r0,r1,r2',
		'mrs sp,primask',
		'ldr r8,[r0]',
		'push {}',
		'.arm',
		'.org 0x400001\nnop',
	])('rejects unsupported/unpredictable source %s', (code) =>
		expect(assemble(code).diagnostics.length).toBeGreaterThan(0),
	)
	it('switches the existing ARM definition without changing its persisted id', async () => {
		expect(definition.id).toBe('armv8')
		expect(definition.variant!(settings).language).toBe('thrax-thumb-m0')
		const services = definition.createServices()
		await services.prepare?.(settings)
		const p = services.assemble({ files: [{ name: 'a.s', code: EXAMPLES.sum.code }], entries: ['a.s'] }, settings)
		const m = services.createMachine(p, settings, { speed: null, historyLimit: 100 })
		finish(m as M0Runtime)
		expect(m.console).toBe('8')
		services.dispose()
		expect(() => services.assemble({ files: [], entries: [] }, settings)).toThrow('disposed')
	})
	it('decodes system hints and traps while rejecting unsupported Thumb-2', () => {
		expect(decode(0xb672).name).toBe('cpsid')
		expect(decode(0xbf40).name).toBe('sev')
		expect(() => decode(0xbf08)).toThrow('Unsupported')
	})
	it('keeps Cortex-M0 CONTROL bit 0 reserved and MRS EPSR read-as-zero', () => {
		const m = machine('movs r0,#1\nmsr control,r0\nmrs r1,control\nmrs r2,epsr\nmrs r3,xpsr\nbkpt #0')
		finish(m)
		expect(m.registerValues().R1).toBe(0)
		expect(m.registerValues().R2).toBe(0)
		expect(m.registerValues().R3).toBe(0)
		expect(m.registerValues().XPSR).toBe(1 << 24)
	})
	it('marks Thumb function pointers while retaining even source addresses', () => {
		const m = machine('ldr r0,=fn\nblx r0\nbkpt #0\n.thumb_func\nfn: movs r1,#42\nbx lr')
		finish(m)
		expect(m.registerValues().R0).toBe(m.program.labels.get('fn')! + 1)
		expect(m.registerValues().R1).toBe(42)
		expect(m.callStack).toEqual([])
	})
	it('rolls back a POP-PC state fault including already loaded registers', () => {
		const m = machine('ldr r0,=0x400000\nmovs r1,#42\npush {r0,r1}\npop {r2,pc}')
		m.step()
		m.step()
		m.step()
		const sp = m.registerValues().R13
		expect(() => m.step()).toThrow('bit 0')
		expect(m.registerValues().R13).toBe(sp)
		expect(m.registerValues().R2).toBe(0)
		expect(m.history.length).toBe(3)
	})
	it('yields with no matching paced source instruction and disposes pending runs', async () => {
		const m = machine('again: b again')
		m.configure({ speed: 1, pacedAddresses: new Set() })
		let progress = 0
		m.onProgress = () => {
			progress++
			m.dispose()
		}
		await m.run()
		expect(progress).toBe(1)
		expect(m.instructionCount).toBeGreaterThan(0)
		expect(m.history.length).toBe(0)
	})
	it('keeps comment punctuation inside strings and character data', () => {
		const p = assemble('bkpt #0\n.data\n.ascii "a@b//c,d" @ comment\n.byte \',\'')
		expect(p.diagnostics).toEqual([])
		expect(Array.from(p.data[0].bytes)).toEqual([97, 64, 98, 47, 47, 99, 44, 100])
		expect(Array.from(p.data[1].bytes)).toEqual([44])
	})
	it('permits LR special transfers and ignores writes to EPSR/IPSR', () => {
		const m = machine(
			'ldr r0,=0xf1000000\nmsr xpsr,r0\nmrs lr,apsr\nmsr epsr,r0\nmsr ipsr,r0\nmrs r1,epsr\nbkpt #0',
		)
		finish(m)
		expect(m.registerValues().R14).toBe(0xf0000000)
		expect(m.registerValues().R1).toBe(0)
		expect(m.registerValues().XPSR).toBe(0xf1000000)
		expect(assemble('bx sp').diagnostics.length).toBeGreaterThan(0)
		expect(() => decode(0x45f8)).toThrow('Unsupported')
	})
})
