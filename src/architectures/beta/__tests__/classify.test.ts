import { describe, expect, it } from 'vitest'
import {
	BetaInstructionInfo, INSN_ALU, INSN_BRANCH, INSN_CALL, INSN_ILLEGAL, INSN_JUMP, INSN_LOAD, INSN_PRIVILEGED, INSN_RETURN, INSN_STORE, INSN_TAKEN,
	classifyBeta,
} from '../classify'
import { OP_ADD, OP_ADDC, OP_BEQ, OP_BNE, OP_JMP, OP_LD, OP_LDR, OP_ST } from '../isa'
import { BETA_REGISTERS, PC_INDEX } from '../registers'

const op = (opcode: number, ra: number, rb: number, rc: number) => ((opcode << 26) | (rc << 21) | (ra << 16) | (rb << 11)) >>> 0
const opc = (opcode: number, ra: number, literal: number, rc: number) => ((opcode << 26) | (rc << 21) | (ra << 16) | (literal & 0xFFFF)) >>> 0

function classify(word: number, pc = 0x100, set: Record<number, number> = {}) {
	const registers = new Int32Array(32)
	for (const [index, value] of Object.entries(set)) registers[Number(index)] = value
	return { ...classifyBeta(word, pc, registers, new BetaInstructionInfo()) }
}

describe('Beta instruction classification', () => {
	it('reports ALU sources and destination, never R31', () => {
		expect(classify(op(OP_ADD, 1, 2, 3))).toMatchObject({ flags: INSN_ALU, source1: 1, source2: 2, destination: 3 })
		expect(classify(opc(OP_ADDC, 31, 5, 31))).toMatchObject({ flags: INSN_ALU, source1: -1, source2: -1, destination: -1 })
	})

	it('computes load and store addresses from the registers before the step', () => {
		expect(classify(opc(OP_LD, 1, -4, 1), 0, { 1: 0x104 })).toMatchObject({ flags: INSN_LOAD, memoryAddress: 0x100, source1: 1, destination: 1 })
		expect(classify(opc(OP_ST, 2, 8, 3), 0, { 2: 0x200 })).toMatchObject({ flags: INSN_STORE, memoryAddress: 0x208, source1: 2, source2: 3, destination: -1 })
		expect(classify(opc(OP_LDR, 31, 2, 4), 0x80000010)).toMatchObject({ flags: INSN_LOAD, memoryAddress: 0x1C, destination: 4 })
	})

	it('resolves branches, calls and returns', () => {
		expect(classify(opc(OP_BEQ, 1, 3, 31), 0x100, { 1: 0 })).toMatchObject({ flags: INSN_BRANCH | INSN_TAKEN, target: 0x110 })
		expect(classify(opc(OP_BEQ, 1, 3, 31), 0x100, { 1: 1 })).toMatchObject({ flags: INSN_BRANCH, target: 0x110 })
		expect(classify(opc(OP_BNE, 1, -1, 31), 0x100, { 1: 1 }).target).toBe(0x100)
		expect(classify(opc(OP_BEQ, 31, 7, 28))).toMatchObject({ flags: INSN_BRANCH | INSN_TAKEN | INSN_CALL, destination: 28 })
		expect(classify(opc(OP_JMP, 28, 0, 31), 0x100, { 28: 0x40 })).toMatchObject({ flags: INSN_JUMP | INSN_TAKEN | INSN_RETURN, target: 0x40 })
		expect(classify(opc(OP_JMP, 5, 0, 28), 0x100, { 5: 0x81 })).toMatchObject({ flags: INSN_JUMP | INSN_TAKEN | INSN_CALL, target: 0x80 })
	})

	it('flags privileged and illegal opcodes', () => {
		expect(classify(opc(0, 0, 2, 0)).flags).toBe(INSN_PRIVILEGED)
		expect(classify(0xBC000000).flags).toBe(INSN_ILLEGAL)
	})
})

describe('Beta register and pipeline descriptions', () => {
	it('describes R0-R31 with aliases, R31 read-only, then the PC', () => {
		expect(BETA_REGISTERS).toHaveLength(33)
		expect(BETA_REGISTERS.slice(27, 31).map((register) => register.name)).toEqual(['BP', 'LP', 'SP', 'XP'])
		expect(BETA_REGISTERS[29].role).toBe('stackPointer')
		expect(BETA_REGISTERS.filter((register) => !register.editable).map((register) => register.id)).toEqual(['R31'])
		expect(BETA_REGISTERS[PC_INDEX]).toMatchObject({ id: 'PC', role: 'programCounter' })
		expect(BETA_REGISTERS[PC_INDEX].fields?.[0]).toMatchObject({ name: 'S', bit: 31, width: 1 })
	})
})
