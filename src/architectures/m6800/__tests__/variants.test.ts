import { afterEach, describe, expect, it } from 'vitest'
import definition from '../index'
import * as m6809 from '../m6809'
import * as hc11 from '../hc11'
import type { ArchitectureServices } from '../../contracts'
import { ConfiguredRuntime } from '../../../core/configuredRuntime'

const services: ArchitectureServices[] = []
function load(code: string, model: 'm6809' | 'hc11') {
	const service = definition.createServices(), settings = { cpuModel: model }
	services.push(service)
	const program = service.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
	expect(program.diagnostics).toEqual([])
	const machine = service.createMachine(program, settings, { speed: null, historyLimit: 100000 }) as ConfiguredRuntime
	return { machine, program, service }
}
const steps = (machine: ConfiguredRuntime, n: number) => { for (let i = 0; i < n; i++) machine.step() }
afterEach(() => { for (const service of services.splice(0)) service.dispose() })

describe('6809 native encoding and addressing', () => {
	it.each([
		['nop', [], [0x12]], ['lda', ['#42'], [0x86, 42]], ['ldd', ['#4660'], [0xcc, 0x12, 0x34]],
		['ldy', ['#4660'], [0x10, 0x8e, 0x12, 0x34]], ['lds', ['#4660'], [0x10, 0xce, 0x12, 0x34]],
		['cmpu', ['#4660'], [0x11, 0x83, 0x12, 0x34]], ['pshs', ['cc', 'a', 'b', 'dp', 'x', 'y', 'u', 'pc'], [0x34, 0xff]],
		['tfr', ['a', 'dp'], [0x1f, 0x8b]], ['leax', ['-1', 'x'], [0x30, 0x1f]],
		['lda', ['', 'x++'], [0xa6, 0x81]], ['lda', ['a', 'y'], [0xa6, 0xa6]], ['lda', ['[d,u]'], [0xa6, 0xdb]],
		['lda', ['[4660]'], [0xa6, 0x9f, 0x12, 0x34]], ['lda', ['16', 'x'], [0xa6, 0x88, 16]],
		['lda', ['>128', 's'], [0xa6, 0xe9, 0, 128]], ['lbeq', ['4104'], [0x10, 0x27, 0, 4]],
		['jsr', ['<32'], [0x9d, 32]], ['swi2', [], [0x10, 0x3f]],
	] as const)('encodes %s with independent manual bytes', (n, args, bytes) => { expect(m6809.encode(n, args, { address: 0x1000, value: Number })).toEqual(bytes) })
	it('uses DP, native pre-decrement stacks, word order and D aliases', () => {
		const { machine } = load('lda #64\ntfr a,dp\nldd #0x1234\nstd <32\npshs d,x\nclra\nclrb\npuls d,x', 'm6809')
		steps(machine, 5)
		expect(machine.registerValues()).toMatchObject({ dp: 64, d: 0x1234, sp: 0xeffb })
		expect(machine.memory[0x4020]).toBe(0x12); expect(machine.memory[0x4021]).toBe(0x34)
		steps(machine, 3); expect(machine.registerValues()).toMatchObject({ a: 0x12, b: 0x34, d: 0x1234, sp: 0xefff })
		machine.writeRegister('d', 0xabcd); expect(machine.registerValues()).toMatchObject({ a: 0xab, b: 0xcd, d: 0xabcd })
		machine.stepBack(); expect(machine.registerValues().d).toBe(0x1234)
	})
	it('decodes auto-index, accumulator offsets, indirect words and PC-relative labels', () => {
		const { machine } = load('ldx #data\nlda ,x+\nldb ,x++\nldu #pointer\nlda [,u]\nleay Named,pcr\n.data\ndata: .byte 10,20,30\npointer: .word data\nNamed: .byte 40', 'm6809')
		steps(machine, 3); expect(machine.registerValues()).toMatchObject({ a: 10, b: 20, x: 0x4003 })
		steps(machine, 3); expect(machine.registerValues()).toMatchObject({ a: 10, y: 0x4005 })
	})
	it('preserves 6809 V on right shifts and C on TST, and uses full-width CMPX flags', () => {
		const { machine } = load('lda #0\norcc #3\nlsra\ntsta\nldx #0\ncmpx #1', 'm6809')
		steps(machine, 3); expect(Number(machine.registerValues().cc) & 15).toBe(6)
		machine.writeRegister('cc', 3); machine.step(); expect(Number(machine.registerValues().cc) & 15).toBe(5)
		steps(machine, 2); expect(Number(machine.registerValues().cc) & 15).toBe(9)
	})
	it('rejects unsupported CPU forms, reserved postbytes and mixed-width register transfers', () => {
		for (const [n, args] of [['tfr', ['a', 'x']], ['lda', ['[,x+]']], ['inx', []], ['pshs', ['s']]] as const) expect(() => m6809.encode(n, args, { address: 0x1000, value: Number })).toThrow()
		expect(() => m6809.decode(new Uint8Array([0xa6, 0x87]), 0)).toThrow(/postbyte/)
	})
})

describe('68HC11 native extensions', () => {
	it.each([
		['ldd', ['#4660'], [0xcc, 0x12, 0x34]], ['ldy', ['#4660'], [0x18, 0xce, 0x12, 0x34]],
		['ldy', ['2', 'x'], [0x1a, 0xee, 2]], ['ldy', ['2', 'y'], [0x18, 0xee, 2]],
		['ldx', ['2', 'y'], [0xcd, 0xee, 2]], ['cpd', ['2', 'y'], [0xcd, 0xa3, 2]],
		['ldaa', ['2', 'y'], [0x18, 0xa6, 2]], ['cpy', ['#4660'], [0x18, 0x8c, 0x12, 0x34]],
		['bset', ['32', '#128'], [0x14, 32, 128]], ['brclr', ['2', 'y', '#128', '4104'], [0x18, 0x1f, 2, 128, 3]],
		['pshy', [], [0x18, 0x3c]], ['mul', [], [0x3d]], ['idiv', [], [2]], ['fdiv', [], [3]],
	] as const)('encodes %s independently', (n, args, bytes) => { expect(hc11.encode(n, args, { address: 0x1000, value: Number })).toEqual(bytes) })
	it('distinguishes indexed bases from X/Y destinations on all prefix pages', () => {
		const { machine } = load('ldx #data\nldy 2,x\nldx 0,y\nldaa 2,y\n.data\ndata: .word 0,0x4008,0,0,0x1234\n.byte 0x56', 'hc11')
		steps(machine, 4); expect(machine.registerValues()).toMatchObject({ x: 0x1234, y: 0x4008, a: 0x56 })
	})
	it('models IDIV/FDIV quotient, remainder, overflow and zero-divisor flags', () => {
		const { machine } = load('ldd #100\nldx #7\nidiv\nfdiv\nldx #0\nidiv', 'hc11')
		steps(machine, 3); expect(machine.registerValues()).toMatchObject({ x: 14, d: 2 }); expect(Number(machine.registerValues().cc) & 7).toBe(0)
		machine.step(); expect(machine.registerValues()).toMatchObject({ x: 9362, d: 4 })
		steps(machine, 2); expect(machine.registerValues()).toMatchObject({ x: 65535, d: 4 }); expect(Number(machine.registerValues().cc) & 3).toBe(1)
	})
	it('sets and clears memory bit masks with flags and takes native bit branches', () => {
		const { machine } = load('bset 32,#128\nbrset 32,#128,yes\nldaa #1\nyes: bclr 32,#128\nnop', 'hc11')
		machine.step(); expect(machine.memory[32]).toBe(128); expect(Number(machine.registerValues().cc) & 14).toBe(8)
		machine.step(); expect(machine.pc).toBe(0x1009)
		machine.step(); expect(machine.memory[32]).toBe(0); expect(Number(machine.registerValues().cc) & 14).toBe(4)
		machine.stepBack(); expect(machine.memory[32]).toBe(128)
	})
	it('keeps MUL Z unchanged, supports Y stack transfers and cannot re-mask X through TAP', () => {
		const { machine } = load('ldy #0xabcd\npshy\nldy #0\npuly\nldaa #3\nldab #5\nmul\nldaa #0\ntap\nldaa #64\ntap', 'hc11')
		steps(machine, 4); expect(machine.registerValues().y).toBe(0xabcd)
		steps(machine, 3); expect(machine.registerValues().d).toBe(15)
		steps(machine, 4); expect(machine.registerValues().cc).toBe(0)
	})
	it('rejects other-family opcodes and illegal prefix combinations', () => {
		expect(() => hc11.encode('leax', ['1', 'x'], { address: 0, value: Number })).toThrow()
		expect(() => hc11.decode(new Uint8Array([0x1a, 0x01]), 0)).toThrow(/Illegal/)
	})
})
