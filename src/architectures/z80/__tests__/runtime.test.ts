import { describe, expect, it } from 'vitest'
import { InstructionCategory } from '../../contracts'
import { assembleZ80 } from '../asm'
import { describeInstruction } from '../instructions'
import { Z80Assembly, z80Disassembly } from '../program'
import { Z80Runtime } from '../runtime'

function runtimeFor(code: string) {
	const result = assembleZ80({ name: 'test.z80', code })
	expect(result.diagnostics).toEqual([])
	const program = new Z80Assembly('test.z80', result.image, result.diagnostics, result.values)
	return { runtime: new Z80Runtime(program, { historyLimit: 1000, speed: null }), program }
}

describe('Z80 runtime', () => {
	it('tells observers each instruction, its data accesses and its branches', () => {
		const { runtime } = runtimeFor('\tld sp,$F000\n\tld b,2\nloop:\tpush bc\n\tpop bc\n\tdjnz loop\n\thalt\n')
		const seen: string[] = []
		runtime.observers.push({
			onInstruction: (address, instruction) => seen.push(`${address}:${describeInstruction(instruction as number).mnemonic}`),
			onMemoryWrite: (address, size, value) => seen.push(`w${address.toString(16)}=${value}`),
			onBranch: (address, taken, target) => seen.push(`b${address}:${taken}:${target}`),
		})
		for (let step = 0; step < 9; step++) runtime.step()
		expect(seen.slice(0, 7)).toEqual(['0:LD', '3:LD', '5:PUSH', 'wefff=2', 'weffe=0', '6:POP', '7:DJNZ'])
		expect(seen).toContain('b7:true:5')
		expect(seen).toContain('b7:false:5')
		expect(runtime.halted).toBe(true)
	})

	it('classifies instructions for the statistics tool', () => {
		const info = (bytes: number[]) => describeInstruction(bytes.reduceRight((packed, byte) => packed * 256 + byte, 0))
		expect(info([0xC3, 0, 0]).category).toBe(InstructionCategory.JUMP)
		expect(info([0x20, 0]).category).toBe(InstructionCategory.BRANCH)
		expect(info([0xFF]).category).toBe(InstructionCategory.TRAP)
		expect(info([0x80]).category).toBe(InstructionCategory.ALU)
		expect(info([0xDD, 0x7E, 1]).category).toBe(InstructionCategory.MEMORY)
		expect(info([0xDD, 0xCB, 1, 0x46]).encoding).toBe(4)
	})

	it('maps each instruction to one gutter row of its own length', () => {
		const { program } = runtimeFor('\tld a,5\n\tld (ix+1),$22\n\tnop\nmessage:\tdb "hello, world"\n')
		const rows = (line: number) => program.sourceIndex.rowsForLine('test.z80', line)
		expect(rows(1)).toMatchObject([{ address: 0, length: 2 }])
		expect(rows(2)).toMatchObject([{ address: 2, length: 4 }])
		expect(rows(3)).toMatchObject([{ address: 6, length: 1 }])
		expect(rows(4).map((row) => row.address)).toEqual([7, 11, 15])
		expect(z80Disassembly.row({ address: 2, bytes: [0xDD, 0x36, 0x01, 0x22], instruction: true })).toBe('LD (IX+$01),$22')
		expect(z80Disassembly.row({ address: 7, bytes: [0x68, 0x65], instruction: false })).toBe('DB $68,$65')
	})

	it('steps back over a run, rewinding the T-states', async () => {
		const { runtime } = runtimeFor('\tld a,1\n\tinc a\n\tinc a\n\thalt\n')
		await runtime.run()
		expect(runtime.halted).toBe(true)
		expect(runtime.registerValues().T).toBe(7 + 4 + 4 + 4)
		runtime.stepBack()
		runtime.stepBack()
		expect(runtime.registerValues()).toMatchObject({ A: 2, T: 11, PC: 3 })
	})

	it('steps over CALL and RST to the instruction after', async () => {
		const { runtime } = runtimeFor('\tjp start\n\torg 8\n\tret\nstart:\tld sp,$F000\n\tcall routine\n\trst 8\n\thalt\nroutine:\tret\n')
		runtime.step()
		runtime.step()
		await runtime.stepOver()
		expect(runtime.pc).toBe(15)
		await runtime.stepOver()
		expect(runtime.pc).toBe(16)
	})
})
