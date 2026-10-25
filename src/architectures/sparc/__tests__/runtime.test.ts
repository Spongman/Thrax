import { afterEach, describe, expect, it } from 'vitest'
import definition from '../index'
import type { ArchitectureServices, Machine } from '../../contracts'
import { ConfiguredRuntime } from '../../../core/configuredRuntime'

const services: ArchitectureServices[] = []
function load(code: string) {
	const service = definition.createServices()
	services.push(service)
	const program = service.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, {})
	expect(program.diagnostics).toEqual([])
	const machine = service.createMachine(program, {}, { speed: null, historyLimit: 100000 }) as ConfiguredRuntime
	return { machine, program, service }
}
function steps(machine: Machine, count: number) { for (let i = 0; i < count; i++) machine.step() }
afterEach(() => { for (const service of services.splice(0)) service.dispose() })

describe('SPARC delayed control flow', () => {
	it.each([
		['ba', 0, [0x1004, 0x100c], 1],
		['ba,a', 0, [0x100c, 0x1010], 0],
		['be', 0, [0x1004, 0x1008], 1],
		['be,a', 0, [0x1008, 0x100c], 0],
		['be,a', 0x400000, [0x1004, 0x100c], 1],
	] as const)('handles %s and annul with ICC=%i', (branch, flags, pcs, slot) => {
		const { machine } = load(`${branch} target\ninc %g2\nnop\ntarget: nop`)
		if (flags) machine.writeRegister('psr', flags)
		machine.step(); expect(machine.pc).toBe(pcs[0])
		const registers = machine.registerValues()
		machine.step(); expect(machine.pc).toBe(pcs[1]); expect(machine.registerValues().g2).toBe(slot)
		machine.stepBack(); expect(machine.registerValues()).toEqual(registers)
		machine.step(); expect(machine.pc).toBe(pcs[1]); expect(machine.registerValues().g2).toBe(slot)
	})
	it('links the call PC and closes the frame only after the return delay instruction', () => {
		const { machine } = load('call fn\nmov 7,%o0\nnop\nfn: retl\ninc %o0')
		machine.step()
		expect(machine.registerValues()).toMatchObject({ o7: 0x1000, npc: 0x100c, PC: 0x1004 })
		expect(machine.callStack).toMatchObject([{ callAddress: 0x1000, returnAddress: 0x1008, targetAddress: 0x100c }])
		machine.step(); expect(machine.pc).toBe(0x100c)
		machine.step(); expect(machine.pc).toBe(0x1010); expect(machine.callStack).toHaveLength(1)
		machine.step(); expect(machine.pc).toBe(0x1008); expect(machine.registerValues().o0).toBe(8); expect(machine.callStack).toEqual([])
		machine.stepBack(); expect(machine.pc).toBe(0x1010); expect(machine.callStack).toHaveLength(1)
		machine.step(); expect(machine.pc).toBe(0x1008); expect(machine.callStack).toEqual([])
	})
	it('steps over and out after RESTORE executes in the return delay slot', async () => {
		const code = 'call fn\nmov 7,%o0\nnop\nfn: save %sp,-96,%sp\ninc %i0\nret\nrestore'
		const { machine } = load(code)
		await machine.stepOver()
		expect(machine.registerValues()).toMatchObject({ PC: 0x1008, o0: 8, psr: 0 })
		expect(machine.callStack).toEqual([])
		const { machine: second } = load(code)
		steps(second, 3)
		expect(second.registerValues().psr).toBe(7)
		await second.stepToReturn()
		expect(second.registerValues()).toMatchObject({ PC: 0x1008, o0: 8, psr: 0 })
		expect(second.callStack).toEqual([])
	})
	it('faults atomically on unsupported nested delay transfers and resets nPC on a PC edit', () => {
		const { machine } = load('ba target\nba target\nnop\ntarget: nop')
		machine.step()
		const before = machine.registerValues(), state = machine.state.slice()
		expect(() => machine.step()).toThrow(/delay slots/)
		expect(machine.registerValues()).toEqual(before); expect(machine.state).toEqual(state)
		expect(machine.instructionCount).toBe(1)
		machine.setProgramCounter(0x1008)
		expect(machine.registerValues().npc).toBe(0x100c)
		machine.step(); expect(machine.pc).toBe(0x100c)
	})
	it('reports conditional branches to shared predictors without counting BA as conditional', () => {
		const { machine } = load('ba target\nnop\ntarget: bne end\nnop\nend: nop')
		const branches: boolean[] = []
		machine.observers.push({ onBranch: (_address, taken) => branches.push(taken) })
		steps(machine, 5)
		expect(branches).toEqual([true])
	})
})

describe('SPARC register windows and typed history', () => {
	it('overlaps outs/ins, reads SAVE operands in the old window and writes its result in the new one', () => {
		const { machine } = load('mov 42,%o0\nmov 99,%l0\nsave %sp,-96,%sp\nmov 7,%l0\nrestore %i0,1,%o1\nnop')
		const stack = Number(machine.registerValues().o6)
		steps(machine, 3)
		expect(machine.registerValues()).toMatchObject({ psr: 7, i0: 42, i6: stack, o6: stack - 96, l0: 0 })
		machine.step(); machine.writeRegister('i0', 43)
		machine.step()
		expect(machine.registerValues()).toMatchObject({ psr: 0, o0: 43, o1: 44, l0: 99, o6: stack })
		const registers = machine.registerValues(), state = machine.state.slice(), rows = machine.history.length
		while (machine.stepBack()) { /* Restore every physical bank as well as visible registers. */ }
		expect(machine.registerValues()).toMatchObject({ psr: 0, o0: 0, l0: 0 })
		expect(machine.state.filter(Boolean)).toEqual(new Uint32Array([stack]))
		steps(machine, rows)
		expect(machine.registerValues()).toEqual(registers); expect(machine.state).toEqual(state)
		machine.writeRegister('psr', 7)
		expect(machine.registerValues().l0).toBe(7)
		machine.stepBack(); expect(machine.registerValues().l0).toBe(99)
	})
	it('keeps window words out of RAM effects and memory tool events', () => {
		const { machine } = load('mov 42,%l0\nsave\nrestore')
		const memory: number[] = []
		machine.observers.push({ onMemoryRead: address => memory.push(address), onMemoryWrite: address => memory.push(address) })
		machine.step()
		const effects = machine.historyFormat.effects(machine.history.at(0)!, true)
		expect(effects).toContainEqual(expect.objectContaining({ register: 'l0', value: 0 }))
		expect(effects.every(effect => effect.address === undefined)).toBe(true)
		machine.stepBack(); machine.step(); steps(machine, 2)
		expect(memory).toEqual([])
	})
	it('enforces WIM and rejects invalid CWP/nPC edits atomically', () => {
		const { machine } = load('save %sp,-96,%sp')
		machine.writeRegister('wim', 128)
		const before = machine.registerValues(), state = machine.state.slice()
		expect(() => machine.step()).toThrow(/window overflow/)
		expect(machine.registerValues()).toEqual(before); expect(machine.state).toEqual(state)
		expect(machine.history.length).toBe(1)
		expect(() => machine.writeRegister('psr', 8)).toThrow(/eight register windows/)
		expect(() => machine.writeRegister('npc', 3)).toThrow(/aligned/)
		expect(machine.writeRegister('g0', 42)).toBe(false)
		expect(machine.registerValues()).toEqual(before)
	})
})

describe('SPARC integer and memory semantics', () => {
	it('records carry as borrow and handles signed overflow and ADDX/SUBX', () => {
		const { machine } = load('subcc %g0,1,%g2\nsubx %g0,0,%g3\nset 0x7fffffff,%g4\naddcc %g4,1,%g5\naddx %g0,0,%g6')
		machine.step(); expect(machine.registerValues()).toMatchObject({ g2: 0xffffffff, psr: 0x900000 })
		machine.step(); expect(machine.registerValues().g3).toBe(0xffffffff)
		steps(machine, 3); expect(machine.registerValues()).toMatchObject({ g5: 0x80000000, psr: 0xa00000 })
		machine.step(); expect(machine.registerValues().g6).toBe(0)
	})
	it('uses exact Y:rs1 multiply/divide and saturates signed overflow', () => {
		const { machine } = load('set 0xffffffff,%g2\numul %g2,%g2,%g3\nwr %g0,0,%y\nudiv %g3,1,%g4\nwr %g0,1,%y\nsdivcc %g0,1,%g5')
		steps(machine, 3); expect(machine.registerValues()).toMatchObject({ g3: 1, y: 0xfffffffe })
		steps(machine, 2); expect(machine.registerValues().g4).toBe(1)
		steps(machine, 2); expect(machine.registerValues()).toMatchObject({ g5: 0x7fffffff, psr: 0x200000 })
	})
	it('loads big-endian pairs and signed values and exchanges bytes/words atomically', () => {
		const { machine } = load('set data,%g2\nldd [%g2],%l0\nldsb [%g2],%l2\nldsh [%g2],%l3\nldstub [%g2],%l4\nswap [%g2+4],%l1\nstd %l0,[%g2+8]\n.data\ndata: .word 0x80ff1234,0xabcdef01,0,0')
		steps(machine, 5)
		expect(machine.registerValues()).toMatchObject({ l0: 0x80ff1234, l1: 0xabcdef01, l2: 0xffffff80, l3: 0xffff80ff })
		machine.step(); expect(machine.registerValues().l4).toBe(128); expect(machine.inspectMemory().byte(0x10000)).toBe(255)
		machine.step(); machine.step()
		expect(machine.inspectMemory().word(0x10008)).toBe(0x80ff1234)
		expect(machine.inspectMemory().word(0x1000c)).toBe(0xabcdef01)
	})
	it('faults atomically on misaligned accesses and divide by zero', () => {
		for (const code of ['ld [%g0+1],%l0', 'udiv %g0,0,%l0']) {
			const { machine } = load(code), before = machine.registerValues(), state = machine.state.slice()
			expect(() => machine.step()).toThrow()
			expect(machine.registerValues()).toEqual(before); expect(machine.state).toEqual(state)
			expect(machine.history.length).toBe(0)
		}
	})
	it('maps two-word pseudos to native rows and supports native .word/.half and %hi/%lo', () => {
		const { machine, program } = load('set 0x12345678,%g2\nsethi %hi(data),%g3\nor %g3,%lo(data),%g3\n.data\ndata: .word 0x12345678\n.half 0xabcd')
		const rows = new Map(program.sourceIndex.lines('main.asm')).get(1)!
		expect(rows.map(row => [row.address, row.length ?? 4])).toEqual([[0x1000, 4], [0x1004, 4]])
		steps(machine, 4)
		expect(machine.registerValues()).toMatchObject({ g2: 0x12345678, g3: 0x10000 })
		expect(Array.from(machine.memory.subarray(0x10000, 0x10006))).toEqual([0x12, 0x34, 0x56, 0x78, 0xab, 0xcd])
	})
})
