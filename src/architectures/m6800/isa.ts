import type { CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'

// Motorola M6800 Programming Reference Manual, November 1976, Appendix A.
export const reference = 'https://www.bitsavers.org/components/motorola/6800/Motorola_M6800_Programming_Reference_Manual_M68PRM%28D%29_Nov76.pdf'
export { A, B, X, SP, CC } from './operations'
import { A, B, X, SP, CC, C, V, Z, N, I, H, flag, nz, arithmetic, branchCondition, push, pop, pushWord, popWord, monitor, unaryValue } from './operations'
const inherent: Record<string, number> = {
	nop: 0x01, tap: 0x06, tpa: 0x07, inx: 0x08, dex: 0x09, clv: 0x0a, sev: 0x0b, clc: 0x0c, sec: 0x0d, cli: 0x0e, sei: 0x0f,
	sba: 0x10, cba: 0x11, tab: 0x16, tba: 0x17, daa: 0x19, aba: 0x1b,
	tsx: 0x30, ins: 0x31, pula: 0x32, pulb: 0x33, des: 0x34, txs: 0x35, psha: 0x36, pshb: 0x37, rts: 0x39, rti: 0x3b, wai: 0x3e, swi: 0x3f,
}
const branches = ['bra', '', 'bhi', 'bls', 'bcc', 'bcs', 'bne', 'beq', 'bvc', 'bvs', 'bpl', 'bmi', 'bge', 'blt', 'bgt', 'ble']
const unary: Record<string, number> = { neg: 0, com: 3, lsr: 4, ror: 6, asr: 7, asl: 8, rol: 9, dec: 10, inc: 12, tst: 13, jmp: 14, clr: 15 }
const alu: Record<string, number> = { suba: 0x80, cmpa: 0x81, sbca: 0x82, anda: 0x84, bita: 0x85, ldaa: 0x86, staa: 0x87, eora: 0x88, adca: 0x89, oraa: 0x8a, adda: 0x8b, cpx: 0x8c, lds: 0x8e, sts: 0x8f, subb: 0xc0, cmpb: 0xc1, sbcb: 0xc2, andb: 0xc4, bitb: 0xc5, ldab: 0xc6, stab: 0xc7, eorb: 0xc8, adcb: 0xc9, orab: 0xca, addb: 0xcb, ldx: 0xce, stx: 0xcf }
export const instructions = [...Object.keys(inherent), ...branches.filter(Boolean), 'bsr', 'jsr', ...Object.keys(unary), ...Object.keys(unary).filter(n => n !== 'jmp').flatMap(n => [n + 'a', n + 'b']), ...Object.keys(alu)]
const normalize = (n: string) => ({ bhs: 'bcc', blo: 'bcs', lsla: 'asla', lslb: 'aslb', lsl: 'asl' }[n.toLowerCase()] ?? n.toLowerCase())
function mode(operands: readonly string[]): number {
	return operands[0]?.startsWith('#') ? 0 : operands.length === 2 && operands[1].toLowerCase() === 'x' ? 2 : operands[0]?.startsWith('<') ? 1 : 3
}
export function instructionSize(name: string, operands: readonly string[]): number {
	const n = normalize(name)
	if (n in inherent || /[ab]$/.test(n) && n.slice(0, -1) in unary && n.slice(0, -1) !== 'jmp') return 1
	if (branches.includes(n) || n === 'bsr') return 2
	if (n in alu || n === 'jsr' || n in unary) return mode(operands) === 3 || mode(operands) === 0 && ['cpx', 'lds', 'ldx'].includes(n) ? 3 : 2
	throw new Error(`Unknown M6800 instruction ${name}`)
}
export function encode(name: string, operands: readonly string[], c: CpuEncodingContext): number[] {
	const n = normalize(name), count = instructionSize(n, operands)
	if (n in inherent) { if (operands.length) throw new Error(`${n} takes no operands`); return [inherent[n]] }
	const branch = branches.indexOf(n)
	if (branch >= 0 || n === 'bsr') {
		if (operands.length !== 1) throw new Error(`${n} needs one target`)
		const offset = c.value(operands[0]) - c.address - 2 << 16 >> 16
		if (offset < -128 || offset > 127) throw new Error('Branch target exceeds signed 8-bit range')
		return [n === 'bsr' ? 0x8d : 0x20 + branch, offset & 255]
	}
	const suffix = n.slice(-1), base = n.slice(0, -1)
	if (base in unary && base !== 'jmp' && (suffix === 'a' || suffix === 'b')) { if (operands.length) throw new Error(`${n} takes no operands`); return [(suffix === 'a' ? 0x40 : 0x50) + unary[base]] }
	const m = mode(operands), value = c.value(operands[0].replace(/^[#<>]/, ''))
	if (operands.length !== (m === 2 ? 2 : 1)) throw new Error(`Invalid ${n} addressing form`)
	if (!Number.isInteger(value) || value < (m === 0 ? count === 3 ? -32768 : -128 : 0) || value > (count === 3 ? 65535 : 255)) throw new Error(`Operand exceeds ${count === 3 ? 16 : 8} bits`)
	if (m === 2 && (value < 0 || value > 255)) throw new Error('M6800 indexed offset must be 0..255')
	if (m === 1 && (value < 0 || value > 255)) throw new Error('Direct address must be 0..255')
	if ((n.startsWith('st') || n === 'jsr' || n in unary) && m === 0) throw new Error(`${n} has no immediate form`)
	if (n === 'jsr' && m === 1) throw new Error('M6800 JSR has indexed and extended forms only')
	if (n in unary && m === 1) throw new Error('M6800 memory unary instructions have indexed and extended forms only')
	const op = n in alu ? alu[n] + m * 16 : n === 'jsr' ? m === 2 ? 0xad : 0xbd : (m === 2 ? 0x60 : 0x70) + unary[n]
	return count === 3 ? [op, value >>> 8 & 255, value & 255] : [op, value & 255]
}
export function decode(memory: Uint8Array, address: number, indexRegister = X): CpuInstruction {
	const op = memory[address], byte = memory[address + 1 & 65535], word = byte << 8 | memory[address + 2 & 65535]
	const named = Object.entries(inherent).find(([, v]) => v === op)?.[0]
	if (named) return { size: 1, text: named.toUpperCase(), kind: op === 0x39 ? 'return' : op === 0x3f ? 'system' : 'alu', execute(c) {
		switch (op) {
			case 1: break
			case 6: c.r[CC] = c.r[A] | 0xc0; break
			case 7: c.r[A] = c.r[CC]; break
			case 8: c.r[X] = c.r[X] + 1 & 65535; flag(c, Z, c.r[X] === 0); break
			case 9: c.r[X] = c.r[X] - 1 & 65535; flag(c, Z, c.r[X] === 0); break
			case 10: case 11: flag(c, V, op === 11); break
			case 12: case 13: flag(c, C, op === 13); break
			case 14: case 15: flag(c, I, op === 15); break
			case 16: c.r[A] = arithmetic(c, c.r[A], c.r[B], true); break
			case 17: arithmetic(c, c.r[A], c.r[B], true); break
			case 22: c.r[B] = nz(c, c.r[A]); flag(c, V, false); break
			case 23: c.r[A] = nz(c, c.r[B]); flag(c, V, false); break
			case 25: { const a = c.r[A], adjustment = (a & 15) > 9 || c.r[CC] & H ? 6 : 0; const high = a > 0x99 || c.r[CC] & C ? 0x60 : 0; c.r[A] = nz(c, a + adjustment + high); if (high) flag(c, C, true); break }
			case 27: c.r[A] = arithmetic(c, c.r[A], c.r[B], false); break
			case 0x30: c.r[X] = c.r[SP] + 1 & 65535; break
			case 0x31: c.r[SP] = c.r[SP] + 1 & 65535; break
			case 0x32: c.r[A] = pop(c); break
			case 0x33: c.r[B] = pop(c); break
			case 0x34: c.r[SP] = c.r[SP] - 1 & 65535; break
			case 0x35: c.r[SP] = c.r[X] - 1 & 65535; break
			case 0x36: push(c, c.r[A]); break
			case 0x37: push(c, c.r[B]); break
			case 0x39: c.ret(popWord(c)); break
			case 0x3b: c.r[CC] = pop(c) | 0xc0; c.r[B] = pop(c); c.r[A] = pop(c); c.r[X] = popWord(c); c.ret(popWord(c)); break
			case 0x3e: throw new Error('M6800 WAI needs an external interrupt source, which is not modeled')
			case 0x3f: monitor(c); break
		}
	} }
	if (op >= 0x20 && op <= 0x2f && branches[op - 0x20] || op === 0x8d) {
		const target = address + 2 + (byte << 24 >> 24) & 65535
		return { size: 2, text: `${op === 0x8d ? 'BSR' : branches[op - 0x20].toUpperCase()} $${target.toString(16)}`, call: op === 0x8d, kind: op === 0x8d ? 'call' : 'branch', execute(c) {
			if (op === 0x8d) { pushWord(c, c.pc); c.call(target); return }
			const taken = branchCondition(c, op - 0x20)
			c.branch(target, taken)
			if (taken) c.pc = target
		} }
	}
	if (op === 0xad || op === 0xbd) return { size: op === 0xad ? 2 : 3, text: `JSR ${op === 0xad ? `${byte},${indexRegister === X ? 'X' : 'Y'}` : '$' + word.toString(16)}`, call: true, kind: 'call', execute(c) { const target = op === 0xad ? c.r[indexRegister] + byte & 65535 : word; pushWord(c, c.pc); c.call(target) } }
	if (op >= 0x40 && op <= 0x7f && Object.values(unary).includes(op & 15) && !((op & 15) === 14 && op < 0x60)) {
		const group = op >>> 4, low = op & 15, name = Object.keys(unary).find(k => unary[k] === low)!
		return { size: group < 6 ? 1 : group === 6 ? 2 : 3, text: `${name.toUpperCase()}${group < 6 ? group === 4 ? 'A' : 'B' : group === 6 ? ` ${byte},X` : ` $${word.toString(16)}`}`, kind: low === 14 ? 'jump' : 'alu', execute(c) {
			const ea = group === 6 ? c.r[indexRegister] + byte & 65535 : word
			if (low === 14) { c.pc = ea; return }
			const ri = group === 4 ? A : B, value = group < 6 ? c.r[ri] : c.read(ea), result = unaryValue(c, low, value)
			if (low !== 13) { if (group < 6) c.r[ri] = result; else c.write(ea, result) }
		} }
	}
	if (op >= 0x80) {
		const m = op >>> 4 & 3, base = op - m * 16, name = Object.keys(alu).find(k => alu[k] === base), low = op & 15
		if (name && !(m === 0 && [7, 15].includes(low))) {
			const wide = low === 12 || low >= 14, size = m === 3 || m === 0 && wide ? 3 : 2
			return { size, text: `${name.toUpperCase()} ${m === 0 ? '#' : ''}${m === 2 ? `${byte},X` : '$' + (size === 3 ? word : byte).toString(16)}`, kind: low === 7 || low === 15 ? 'store' : low === 6 || low === 14 ? 'load' : 'alu', execute(c) {
				const ea = m === 1 ? byte : m === 2 ? c.r[indexRegister] + byte & 65535 : word
				const reg = wide ? low === 12 || op >= 0xc0 ? X : SP : op >= 0xc0 ? B : A
				const left = c.r[reg]
				if (low === 7 || low === 15) { if (wide) { c.write(ea, left >>> 8); c.write(ea + 1 & 65535, left & 255) } else c.write(ea, left); nz(c, left, wide ? 16 : 8); flag(c, V, false); return }
				const value = m === 0 ? wide ? word : byte : wide ? c.read(ea) << 8 | c.read(ea + 1 & 65535) : c.read(ea)
				if (low === 12) {
					// Original 6800 compares the two bytes independently. Unlike 6801,
					// low-byte borrow does not feed the N/V high-byte subtraction.
					const hi = left >>> 8, rhs = value >>> 8, result = hi - rhs
					flag(c, N, !!(result & 128)); flag(c, Z, left === value)
					flag(c, V, !!((hi ^ rhs) & (hi ^ result) & 128))
					return
				}
				if (low === 14) { c.r[reg] = nz(c, value, 16); flag(c, V, false); return }
				let result = left
				switch (low) {
					case 0: case 1: case 2: result = arithmetic(c, left, value, true, low === 2 ? c.r[CC] & C : 0); break
					case 4: case 5: result = nz(c, left & value); flag(c, V, false); break
					case 6: result = nz(c, value); flag(c, V, false); break
					case 8: result = nz(c, left ^ value); flag(c, V, false); break
					case 9: case 11: result = arithmetic(c, left, value, false, low === 9 ? c.r[CC] & C : 0); break
					case 10: result = nz(c, left | value); flag(c, V, false); break
				}
				if (low !== 1 && low !== 5) c.r[reg] = result
			} }
		}
	}
	throw new Error(`Illegal M6800 opcode $${op.toString(16).padStart(2, '0')} at $${address.toString(16)}`)
}
