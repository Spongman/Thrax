import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'
import { arithmetic, compare, convert, DOUBLE, DZ, F0, fbranches, fbranchMasks, fpFault, fpMemory, fpopByCode, fpops, fpRegister, FSR, FSR_WRITABLE, fromInteger, isFpRegister, multiplyWiden, NV, NX, OF, SINGLE, squareRoot, toInteger, UF, type FpResult } from './fpu'

export const NPC = 32, PSR = 33, Y = 34, WIM = 35
export const STATE_WORDS = 142
// COMPARE marks an FPop2; AFTER_COMPARE holds it for the next instruction.
const DELAY = 136, IN_DELAY = 137, RETURN = 138, RETURN_NOW = 139, COMPARE = 140, AFTER_COMPARE = 141
const N = 0x800000, Z = 0x400000, V = 0x200000, C = 0x100000
// Mirrors: https://www.cs.utexas.edu/~novak/sparcv8.pdf (byte-identical)
// Mirrors: https://sparc.org/wp-content/uploads/2014/01/v8.pdf.gz (official but gzipped, so no #page; not byte-identical, same page numbers)
export const reference = 'https://research.swtch.com/sparcv8.pdf'
export const registerNames = Array.from({ length: 32 }, (_, i) => `${['g', 'o', 'l', 'i'][i >>> 3]}${i & 7}`)
const alu: Record<string, number> = { add: 0, and: 1, or: 2, xor: 3, sub: 4, andn: 5, orn: 6, xnor: 7, addx: 8, umul: 10, smul: 11, subx: 12, udiv: 14, sdiv: 15 }
const memoryOps: Record<string, number> = { ld: 0, ldub: 1, lduh: 2, ldd: 3, st: 4, stb: 5, sth: 6, std: 7, ldsb: 9, ldsh: 10, ldstub: 13, swap: 15 }
export const branches = ['bn', 'be', 'ble', 'bl', 'bleu', 'bcs', 'bneg', 'bvs', 'ba', 'bne', 'bg', 'bge', 'bgu', 'bcc', 'bpos', 'bvc']
const branchNames: Record<string, number> = Object.fromEntries(branches.map((n, i) => [n, i]))
Object.assign(branchNames, { bz: 1, bnz: 9, blu: 5, bgeu: 13 })
const traps = branches.map(n => `t${n.slice(1)}`)
const fbranchNames: Record<string, number> = Object.fromEntries(fbranches.map((n, i) => [n, i]))
Object.assign(fbranchNames, { fbnz: 1, fbz: 9 })
export const instructions = [...Object.keys(alu).flatMap(n => [n, `${n}cc`]), ...Object.keys(memoryOps), ...Object.keys(branchNames).flatMap(n => [n, `${n},a`]), ...traps, 'sethi', 'set', 'sll', 'srl', 'sra', 'call', 'jmpl', 'jmp', 'ret', 'retl', 'save', 'restore', 'rd', 'wr', 'flush', 'stbar', 'nop', 'mov', 'clr', 'cmp', 'tst', 'not', 'neg', 'inc', 'inccc', 'dec', 'deccc', 'btst', 'bset', 'bclr', 'btog', ...Object.keys(fpops), ...Object.keys(fpMemory), ...Object.keys(fbranchNames).flatMap(n => [n, `${n},a`])]

export function reg(text: string): number {
	const name = text.trim().replace(/^%/, '').toLowerCase()
	if (name === 'sp') return 14
	if (name === 'fp') return 30
	const m = /^([goli])([0-7])$/.exec(name)
	if (m) return 'goli'.indexOf(m[1]) * 8 + Number(m[2])
	const r = /^r(\d+)$/.exec(name)
	if (r && Number(r[1]) < 32) return Number(r[1])
	throw new Error(`Expected a SPARC integer register, got ${text}`)
}
function physical(cpu: CpuContext, index: number) {
	if (index < 8) return index
	const cwp = cpu.r[PSR] & 7
	return 8 + (index < 16 ? (cwp + 7) & 7 : cwp) * 16 + (index < 16 ? 8 + (index & 7) : index - 16)
}
export const getRegister = (cpu: CpuContext, index: number) => index === 0 ? 0 : cpu.state[physical(cpu, index)]
export function setRegister(cpu: CpuContext, index: number, value: number) { if (index) cpu.writeState(physical(cpu, index), value) }
export function advance(cpu: CpuContext) {
	cpu.writeState(IN_DELAY, cpu.state[DELAY]); cpu.writeState(DELAY, 0)
	cpu.writeState(RETURN_NOW, cpu.state[RETURN]); cpu.writeState(RETURN, 0)
	cpu.writeState(AFTER_COMPARE, cpu.state[COMPARE]); cpu.writeState(COMPARE, 0)
	cpu.pc = cpu.r[NPC]
	cpu.r[NPC] = cpu.pc + 4
}
export function afterInstruction(cpu: CpuContext) {
	if (cpu.state[RETURN_NOW]) {
		const target = cpu.state[RETURN_NOW] - 1, pc = cpu.pc
		cpu.ret(target); cpu.pc = pc
		cpu.writeState(RETURN_NOW, 0)
	}
}
function checkTarget(target: number) { if (target & 3) throw new Error('SPARC instruction target must be word aligned') }
function delayed(cpu: CpuContext) { if (cpu.state[IN_DELAY]) throw new Error('Control transfers in delay slots are not supported by this teaching core') }
function transfer(cpu: CpuContext, target: number) { cpu.r[NPC] = target >>> 0; cpu.writeState(DELAY, 1) }
function condition(cpu: CpuContext, code: number) {
	const f = cpu.r[PSR], n = !!(f & N), z = !!(f & Z), v = !!(f & V), c = !!(f & C)
	const base = [false, z, z || n !== v, n !== v, c || z, c, n, v][code & 7]
	return code & 8 ? !base : base
}
function flags(cpu: CpuContext, value: number, overflow = false, carry = false) {
	cpu.r[PSR] = cpu.r[PSR] & ~0xf00000 | (value & 0x80000000 ? N : 0) | ((value >>> 0) === 0 ? Z : 0) | (overflow ? V : 0) | (carry ? C : 0)
}
/** Shared Bicc/FBfcc delayed transfer with annulment. */
function delayedBranch(c: CpuContext, cond: number, taken: boolean, annul: boolean, target: number) {
	const next = c.pc
	if (cond !== 8) { c.branch(target, taken); c.pc = next }
	if (annul && (!taken || cond === 8)) { c.pc = taken ? target : c.r[NPC]; c.r[NPC] = c.pc + 4 }
	else { if (taken) c.r[NPC] = target; c.writeState(DELAY, 1) }
}
/** Even/odd pairs hold doubles with the high word in the even register. */
function readFp(c: CpuContext, n: number, width: number) {
	return width === 2 ? BigInt(c.r[F0 + n]) << 32n | BigInt(c.r[F0 + n + 1]) : BigInt(c.r[F0 + n])
}
function writeFp(c: CpuContext, n: number, width: number, raw: bigint) {
	if (width === 2) { c.r[F0 + n] = Number(raw >> 32n); c.r[F0 + n + 1] = Number(raw & 0xffffffffn) }
	else c.r[F0 + n] = Number(raw & 0xffffffffn)
}
const exceptionNames = (bits: number) => [[NV, 'invalid'], [OF, 'overflow'], [UF, 'underflow'], [DZ, 'division-by-zero'], [NX, 'inexact']].filter(([bit]) => bits & +bit).map(([, name]) => name).join(', ')
const bytes = (word: number) => [word >>> 24, word >>> 16 & 255, word >>> 8 & 255, word & 255]
function integer(value: number, min: number, max: number, what: string) {
	if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${what} must be ${min} through ${max}`)
	return value
}
function value(text: string, context: CpuEncodingContext): number {
	const m = /^%(hi|lo)\((.*)\)$/i.exec(text.trim())
	return m ? m[1].toLowerCase() === 'hi' ? context.value(m[2]) >>> 10 : context.value(m[2]) & 1023 : context.value(text)
}
function operand(text: string, context: CpuEncodingContext) {
	if (/^%?(?:[goli][0-7]|r\d+|sp|fp)$/i.test(text.trim())) return reg(text)
	return 0x2000 | integer(value(text, context), -4096, 4095, 'Signed immediate') & 8191
}
function address(text: string, context: CpuEncodingContext): [number, number] {
	const source = text.trim().replace(/^\[(.*)\]$/, '$1').trim()
	const m = /^(%?(?:[goli][0-7]|r\d+|sp|fp))(?:\s*([+-])\s*(.+))?$/i.exec(source)
	if (!m) return [0, operand(source, context)]
	return [reg(m[1]), m[3] ? operand(m[2] === '-' ? `-(${m[3]})` : m[3], context) : 0x2000]
}
const format3 = (op: number, rd: number, op3: number, rs1: number, arg: number) => op << 30 | rd << 25 | op3 << 19 | rs1 << 14 | arg
export const instructionSize = (name: string) => name.toLowerCase() === 'set' ? 8 : 4
export function encode(mnemonic: string, args: readonly string[], context: CpuEncodingContext): number[] {
	let name = mnemonic.toLowerCase(), o = [...args]
	if (!instructions.includes(name)) throw new Error(`Unsupported SPARC instruction ${mnemonic}`)
	const count = (n: number) => { if (o.length !== n) throw new Error(`${name} expects ${n} operands`) }
	if (name === 'nop') { count(0); return bytes(0x01000000) }
	if (name === 'stbar') { count(0); return bytes(0x8143c000) }
	if (name === 'set') {
		count(2); const n = integer(value(o[0], context), -2147483648, 4294967295, '32-bit constant'), d = reg(o[1])
		return [...bytes(d << 25 | 4 << 22 | n >>> 10), ...bytes(format3(2, d, 2, d, 0x2000 | n & 1023))]
	}
	if (name === 'sethi') { count(2); return bytes(reg(o[1]) << 25 | 4 << 22 | integer(value(o[0], context), 0, 0x3fffff, 'High immediate')) }
	if (name === 'call') {
		count(1); const delta = (value(o[0], context) - context.address) | 0
		checkTarget(delta); return bytes(0x40000000 | delta >>> 2)
	}
	const annul = name.endsWith(',a'), branch = annul ? name.slice(0, -2) : name
	if (branch in branchNames) {
		count(1); const delta = integer(value(o[0], context) - context.address, -8388608, 8388604, 'Branch displacement')
		checkTarget(delta); return bytes(+annul << 29 | branchNames[branch] << 25 | 2 << 22 | delta >> 2 & 0x3fffff)
	}
	if (branch in fbranchNames) {
		count(1); const delta = integer(value(o[0], context) - context.address, -8388608, 8388604, 'Branch displacement')
		checkTarget(delta); return bytes(+annul << 29 | fbranchNames[branch] << 25 | 6 << 22 | delta >> 2 & 0x3fffff)
	}
	if (name in fpops) {
		const [op3, opf, w1, w2, wd] = fpops[name]
		count([w1, w2, wd].filter(Boolean).length)
		const rs1 = w1 ? fpRegister(o[0], w1) : 0, rs2 = fpRegister(o[w1 ? 1 : 0], w2), rd = wd ? fpRegister(o[o.length - 1], wd) : 0
		return bytes(format3(2, rd, op3, rs1, opf << 5 | rs2))
	}
	// GNU spellings: ld/ldd/st/std with an FP register, %fsr or %fq select the FP forms.
	const special = (o[/^st/.test(name) ? 0 : 1] ?? '').trim().toLowerCase()
	if (['ld', 'ldd', 'st', 'std'].includes(name) && (isFpRegister(special) || special === '%fsr' || special === '%fq')) {
		const mapped = special === '%fsr' ? ({ ld: 'ldfsr', st: 'stfsr' } as Record<string, string>)[name] : special === '%fq' ? ({ std: 'stdfq' } as Record<string, string>)[name] : `${name}f`
		if (!mapped) throw new Error(`${name} cannot transfer ${special}`)
		name = mapped
	}
	if (name in fpMemory) {
		count(2); const store = name.startsWith('st'), target = o[store ? 0 : 1].trim().toLowerCase(), [a, b] = address(o[store ? 1 : 0], context)
		const fixed = name === 'ldfsr' || name === 'stfsr' ? '%fsr' : name === 'stdfq' ? '%fq' : ''
		if (fixed && target !== fixed) throw new Error(`${name} expects ${fixed}`)
		return bytes(format3(3, fixed ? 0 : fpRegister(target, name === 'lddf' || name === 'stdf' ? 2 : 1), fpMemory[name], a, b))
	}
	if (traps.includes(name)) {
		count(1); const [a, b] = address(o[0], context)
		if (b & 0x2000) integer(b << 19 >> 19, -64, 127, 'Trap immediate')
		return bytes(format3(2, traps.indexOf(name), 0x3a, a, b & 0x2000 ? 0x2000 | b & 127 : b))
	}
	if (name === 'ret' || name === 'retl') { count(0); o = [name === 'ret' ? '%i7+8' : '%o7+8', '%g0']; name = 'jmpl' }
	if (name === 'jmp') { count(1); o.push('%g0'); name = 'jmpl' }
	if (name === 'jmpl' || name === 'flush') {
		count(name === 'flush' ? 1 : 2); const [a, b] = address(o[0], context)
		return bytes(format3(2, name === 'flush' ? 0 : reg(o[1]), name === 'flush' ? 0x3b : 0x38, a, b))
	}
	if (name === 'rd') { count(2); if (o[0].toLowerCase() !== '%y') throw new Error('Only the unprivileged %y special register is implemented'); return bytes(format3(2, reg(o[1]), 0x28, 0, 0)) }
	if (name === 'wr') { count(3); if (o[2].toLowerCase() !== '%y') throw new Error('Only the unprivileged %y special register is implemented'); return bytes(format3(2, 0, 0x30, reg(o[0]), operand(o[1], context))) }
	if (name in memoryOps) {
		count(2); const store = /^st/.test(name) && name !== 'ldstub', d = reg(o[store ? 0 : 1]), [a, b] = address(o[store ? 1 : 0], context)
		if ((name === 'ldd' || name === 'std') && d & 1) throw new Error('Doubleword transfers require an even register pair')
		return bytes(format3(3, d, memoryOps[name], a, b))
	}
	if ((name === 'save' || name === 'restore') && o.length === 0) o = ['%g0', '%g0', '%g0']
	if (name === 'mov') { count(2); o = ['%g0', o[0], o[1]]; name = 'or' }
	if (name === 'clr') { count(1); o = ['%g0', '%g0', o[0]]; name = 'or' }
	if (name === 'cmp') { count(2); o.push('%g0'); name = 'subcc' }
	if (name === 'btst') { count(2); o = [o[1], o[0], '%g0']; name = 'andcc' }
	if (name === 'tst') { count(1); o = [o[0], '%g0', '%g0']; name = 'orcc' }
	if (name === 'not' || name === 'neg') { if (o.length === 1) o.push(o[0]); count(2); o = name === 'not' ? [o[0], '%g0', o[1]] : ['%g0', o[0], o[1]]; name = name === 'not' ? 'xnor' : 'sub' }
	if (['inc', 'inccc', 'dec', 'deccc'].includes(name)) {
		if (o.length === 1) o.unshift('1')
		count(2); o = [o[1], o[0], o[1]]; name = `${name.startsWith('inc') ? 'add' : 'sub'}${name.endsWith('cc') ? 'cc' : ''}`
	}
	if (['bset', 'bclr', 'btog'].includes(name)) { count(2); o = [o[1], o[0], o[1]]; name = ({ bset: 'or', bclr: 'andn', btog: 'xor' })[name]! }
	count(3)
	const d = reg(o[2]), a = reg(o[0]), cc = name.endsWith('cc'), base = cc ? name.slice(0, -2) : name
	const op3 = base in alu ? alu[base] + (cc ? 16 : 0) : ({ sll: 0x25, srl: 0x26, sra: 0x27, save: 0x3c, restore: 0x3d })[name]
	if (op3 === undefined) throw new Error(`Unsupported SPARC form ${mnemonic}`)
	const b = operand(o[1], context)
	if (op3 >= 0x25 && op3 <= 0x27 && (b & 0x2000) && (b & 8191) > 31) throw new Error('Shift immediate must be 0 through 31')
	return bytes(format3(2, d, op3, a, b))
}

function monitor(cpu: CpuContext) {
	switch (getRegister(cpu, 1)) {
		case 1: cpu.output(String(getRegister(cpu, 8) | 0)); break
		case 4: { let at = getRegister(cpu, 8), text = ''; for (;;) { const b = cpu.read(at++); if (!b) break; text += String.fromCharCode(b) } cpu.output(text); break }
		case 5: setRegister(cpu, 8, cpu.inputInteger(32)); break
		case 10: cpu.halt(); break
		case 11: cpu.output(String.fromCharCode(getRegister(cpu, 8) & 255)); break
		default: throw new Error(`Unsupported THRAX SPARC monitor service ${getRegister(cpu, 1)}`)
	}
}
export function decode(memory: Uint8Array, address: number): CpuInstruction {
	if (address & 3 || address + 4 > memory.length) throw new Error('Unaligned or out-of-range SPARC instruction')
	const w = (memory[address] << 24 | memory[address + 1] << 16 | memory[address + 2] << 8 | memory[address + 3]) >>> 0
	const op = w >>> 30, d = w >>> 25 & 31, op3 = w >>> 19 & 63, a = w >>> 14 & 31, immediate = !!(w & 0x2000), b = w & 31, imm = w << 19 >> 19
	const rn = (n: number) => `%${registerNames[n]}`
	const arg = immediate ? String(imm) : rn(b), addr = `${rn(a)}${immediate ? imm < 0 ? String(imm) : `+${imm}` : `+${rn(b)}`}`
	const reads: string[] = [], writes: string[] = ['npc']
	const read = (...indices: number[]) => { for (const i of indices) if (i) reads.push(registerNames[i]) }
	const write = (...indices: number[]) => { for (const i of indices) if (i) writes.push(registerNames[i]) }
	const operand2 = (cpu: CpuContext) => immediate ? imm >>> 0 : getRegister(cpu, b)
	const make = (text: string, execute: CpuInstruction['execute'], kind: CpuInstruction['kind'] = 'alu', call = false): CpuInstruction => ({ size: 4, text, execute, kind, call, reads, writes })
	if (op === 0 && (w >>> 22 & 7) === 4) {
		write(d); return make(w === 0x01000000 ? 'nop' : `sethi ${w & 0x3fffff},${rn(d)}`, c => setRegister(c, d, w << 10))
	}
	if (op === 1) {
		write(15); const target = address + (w << 2) >>> 0
		return make(`call 0x${target.toString(16)}`, c => { delayed(c); const next = c.pc; setRegister(c, 15, address); c.call(target, address + 8); c.pc = next; transfer(c, target) }, 'call', true)
	}
	if (op === 0 && (w >>> 22 & 7) === 2) {
		const cond = d & 15, annul = !!(w & 0x20000000), target = address + ((w << 10 >> 10) * 4) >>> 0
		if (cond !== 0 && cond !== 8) reads.push('psr')
		return make(`${branches[cond]}${annul ? ',a' : ''} 0x${target.toString(16)}`, c => {
			delayed(c); delayedBranch(c, cond, condition(c, cond), annul, target)
		}, cond === 8 ? 'jump' : 'branch')
	}
	const fr = (n: number) => `%f${n}`
	if (op === 0 && (w >>> 22 & 7) === 6) {
		const cond = d & 15, annul = !!(w & 0x20000000), target = address + ((w << 10 >> 10) * 4) >>> 0
		if (cond !== 0 && cond !== 8) reads.push('fsr')
		return make(`${fbranches[cond]}${annul ? ',a' : ''} 0x${target.toString(16)}`, c => {
			delayed(c)
			if (c.state[AFTER_COMPARE]) throw new Error('SPARC V8 leaves an FBfcc directly after an FPop2 compare undefined; place another instruction between them')
			delayedBranch(c, cond, !!(fbranchMasks[cond] >> (c.r[FSR] >>> 10 & 3) & 1), annul, target)
		}, cond === 8 ? 'jump' : 'branch')
	}
	if (op === 2 && (op3 === 0x34 || op3 === 0x35)) {
		const opf = w >>> 5 & 511, name = fpopByCode.get(op3 << 9 | opf)
		if (!name) return make(`fpop${op3 - 0x33} 0x${opf.toString(16)}`, () => fpFault(3, `opf 0x${opf.toString(16)} is not a SPARC V8 FPop`), 'system')
		const [, , w1, w2, wd] = fpops[name], compare2 = op3 === 0x35
		const regs = (n: number, width: number) => Array.from({ length: width }, (_, i) => `f${n + i & 31}`)
		reads.push('fsr', ...w1 ? regs(a, w1) : [], ...regs(b, w2)); writes.push('fsr', ...wd ? regs(d, wd) : [])
		const text = `${name} ${[...w1 ? [fr(a)] : [], fr(b), ...wd ? [fr(d)] : []].join(',')}`
		return make(text, c => {
			if (w1 === 4 || w2 === 4 || wd === 4) fpFault(3, `${name} needs quad precision, which this FPU does not implement`)
			if (w1 && a % w1 || b % w2 || wd && d % wd) fpFault(6, `${name} needs even-numbered double-precision registers`)
			const fsr = c.r[FSR], x = readFp(c, a, w1 || 1), y = readFp(c, b, w2), p = w2 === 2 ? DOUBLE : SINGLE
			let r: FpResult
			switch (name) {
				case 'fmovs': r = { raw: y, cexc: 0 }; break
				case 'fnegs': r = { raw: y ^ 0x80000000n, cexc: 0 }; break
				case 'fabss': r = { raw: y & 0x7fffffffn, cexc: 0 }; break
				case 'fitos': case 'fitod': r = fromInteger(Number(y), wd === 2 ? DOUBLE : SINGLE, fsr); break
				case 'fstoi': case 'fdtoi': r = toInteger(y, p); break
				case 'fstod': r = convert(y, SINGLE, DOUBLE, fsr); break
				case 'fdtos': r = convert(y, DOUBLE, SINGLE, fsr); break
				case 'fsqrts': case 'fsqrtd': r = squareRoot(y, p, fsr); break
				case 'fsmuld': r = multiplyWiden(x, y); break
				case 'fcmps': case 'fcmpd': case 'fcmpes': case 'fcmped': r = compare(x, y, p, name.startsWith('fcmpe')); break
				default: r = arithmetic(name.slice(1, 4) as 'add' | 'sub' | 'mul' | 'div', x, y, p, fsr)
			}
			const trapped = r.cexc & fsr >>> 23 & 31
			if (trapped) fpFault(1, `${name} raised ${exceptionNames(trapped)} with its FSR.TEM trap enabled`)
			// cexc replaces, aexc accumulates; a compare also sets fcc.
			let next = fsr & ~31 | r.cexc | r.cexc << 5
			if (compare2) { next = next & ~0xc00 | Number(r.raw) << 10; c.writeState(COMPARE, 1) }
			else writeFp(c, d, wd, r.raw)
			c.r[FSR] = next >>> 0
		})
	}
	if (op === 3 && op3 >= 0x20 && op3 < 0x28) {
		const name = Object.keys(fpMemory).find(n => fpMemory[n] === op3)
		if (!name) throw new Error('Unsupported SPARC floating-point memory encoding')
		if (!immediate && (w & 0x1fe0)) throw new Error('Reserved SPARC register-format bits are nonzero')
		const store = name.startsWith('st'), pair = name === 'lddf' || name === 'stdf', fsrOp = name.endsWith('fsr')
		read(a); if (!immediate) read(b)
		const regs = fsrOp || name === 'stdfq' ? [] : pair ? [`f${d}`, `f${d + 1 & 31}`] : [`f${d}`]
		if (store) reads.push(...regs, ...fsrOp ? ['fsr'] : [])
		else writes.push(...regs, ...fsrOp ? ['fsr'] : [])
		const target = fsrOp ? '%fsr' : name === 'stdfq' ? '%fq' : fr(d), size = pair || name === 'stdfq' ? 8 : 4
		return make(store ? `${name} ${target},[${addr}]` : `${name} [${addr}],${target}`, c => {
			if (name === 'stdfq') fpFault(4, 'STDFQ found the deferred-trap queue empty (FSR.qne = 0)')
			if (pair && d & 1) fpFault(6, `${name} needs an even-numbered register`)
			const at = getRegister(c, a) + operand2(c) >>> 0
			if (at % size) throw new Error(`Misaligned SPARC ${size}-byte access`)
			if (name === 'ldf') c.r[F0 + d] = c.read(at, 4)
			else if (name === 'lddf') { const high = c.read(at, 4), low = c.read(at + 4, 4); c.r[F0 + d] = high; c.r[F0 + d + 1] = low }
			else if (name === 'ldfsr') c.r[FSR] = (c.r[FSR] & ~FSR_WRITABLE | c.read(at, 4) & FSR_WRITABLE) >>> 0
			else if (name === 'stf') c.write(at, c.r[F0 + d], 4)
			else if (name === 'stdf') { c.write(at, c.r[F0 + d], 4); c.write(at + 4, c.r[F0 + d + 1], 4) }
			else c.write(at, c.r[FSR], 4)
		}, store ? 'store' : 'load')
	}
	if (op !== 2 && op !== 3) throw new Error(`Unsupported SPARC encoding 0x${w.toString(16)}`)
	if (!immediate && (w & 0x1fe0)) throw new Error('Reserved SPARC register-format bits are nonzero')
	if (op === 3) {
		const name = Object.keys(memoryOps).find(n => memoryOps[n] === op3)
		if (!name) throw new Error('Unsupported SPARC memory encoding')
		const store = ['st', 'stb', 'sth', 'std'].includes(name), pair = name === 'ldd' || name === 'std', atomic = name === 'swap' || name === 'ldstub'
		if (pair && d & 1) throw new Error('Doubleword transfers require an even register pair')
		read(a); if (!immediate) read(b)
		if (store || name === 'swap') { read(d); if (pair) read(d + 1) }
		if (!store) { write(d); if (pair) write(d + 1) }
		const size = pair ? 8 : ['ldub', 'ldsb', 'stb', 'ldstub'].includes(name) ? 1 : ['lduh', 'ldsh', 'sth'].includes(name) ? 2 : 4
		return make(store ? `${name} ${rn(d)},[${addr}]` : `${name} [${addr}],${rn(d)}`, c => {
			const at = getRegister(c, a) + operand2(c) >>> 0
			if (at % size) throw new Error(`Misaligned SPARC ${size}-byte access`)
			if (store) { if (pair) c.write(at + 4, getRegister(c, d + 1), 4); c.write(at, getRegister(c, d), Math.min(size, 4)) }
			else { const value = c.read(at, Math.min(size, 4)), second = pair ? c.read(at + 4, 4) : 0; if (atomic) c.write(at, name === 'swap' ? getRegister(c, d) : 255, size); setRegister(c, d, name === 'ldsb' ? value << 24 >> 24 : name === 'ldsh' ? value << 16 >> 16 : value); if (pair) setRegister(c, d + 1, second) }
		}, store ? 'store' : 'load')
	}
	if (op3 === 0x28) {
		if (w === 0x8143c000) return make('stbar', () => {}, 'system')
		if (a || (w & 0x3fff)) throw new Error('Unsupported SPARC ancillary register read')
		reads.push('y'); write(d); return make(`rd %y,${rn(d)}`, c => setRegister(c, d, c.r[Y]))
	}
	read(a); if (!immediate) read(b)
	if (op3 === 0x30) { if (d) throw new Error('Unsupported SPARC ancillary register write'); writes.push('y'); return make(`wr ${rn(a)},${arg},%y`, c => { c.r[Y] = getRegister(c, a) ^ operand2(c) }) }
	if (op3 === 0x3a) {
		if (d & 16) throw new Error('Reserved SPARC trap condition bit')
		if (immediate && (w & 0x1f80)) throw new Error('Reserved SPARC trap immediate bits')
		reads.push('psr'); read(1, 8); write(8)
		return make(`${traps[d]} ${rn(a)}+${immediate ? w & 127 : rn(b)}`, c => { if (!condition(c, d)) return; const trap = getRegister(c, a) + operand2(c) & 127; if (trap !== 0x10) throw new Error(`Unsupported SPARC software trap ${trap}`); monitor(c) }, 'system')
	}
	if (op3 === 0x38) {
		write(d); const returning = d === 0 && (a === 15 || a === 31) && immediate && imm === 8
		return make(returning ? a === 31 ? 'ret' : 'retl' : `jmpl ${addr},${rn(d)}`, c => {
			delayed(c); const target = getRegister(c, a) + operand2(c) >>> 0; checkTarget(target)
			setRegister(c, d, address)
			if (d === 15) { const next = c.pc; c.call(target, address + 8); c.pc = next }
			if (returning) c.writeState(RETURN, target + 1)
			transfer(c, target)
		}, returning ? 'return' : d === 15 ? 'call' : 'jump', d === 15)
	}
	if (op3 === 0x3b) return make(`flush ${addr}`, () => {}, 'system')
	if (op3 === 0x3c || op3 === 0x3d) {
		writes.push(...registerNames.slice(8), 'psr'); reads.push('psr', 'wim')
		return make(`${op3 === 0x3c ? 'save' : 'restore'} ${rn(a)},${arg},${rn(d)}`, c => {
			const sum = getRegister(c, a) + operand2(c), next = ((c.r[PSR] & 7) + (op3 === 0x3c ? 7 : 1)) & 7
			if (c.r[WIM] & 1 << next) throw new Error(op3 === 0x3c ? 'SPARC window overflow: no trap handler is modeled' : 'SPARC window underflow: no trap handler is modeled')
			c.r[PSR] = c.r[PSR] & ~31 | next; setRegister(c, d, sum)
		})
	}
	const cc = op3 < 32 && !!(op3 & 16), base = op3 & 15, name = op3 < 32 ? Object.keys(alu).find(n => alu[n] === base) : ({ 37: 'sll', 38: 'srl', 39: 'sra' } as Record<number, string>)[op3]
	if (!name) throw new Error(`Unsupported SPARC integer opcode ${op3}`)
	if (op3 >= 0x25 && op3 <= 0x27 && immediate && (w & 8191) > 31) throw new Error('Reserved SPARC shift immediate bits')
	write(d); if (cc || name.endsWith('x')) reads.push('psr'); if (cc) writes.push('psr')
	if (name.includes('mul')) writes.push('y')
	if (name.includes('div')) reads.push('y')
	return make(`${name}${cc ? 'cc' : ''} ${rn(a)},${arg},${rn(d)}`, c => {
		const x = getRegister(c, a), y = operand2(c), carry = name.endsWith('x') && !!(c.r[PSR] & C) ? 1 : 0
		let result: number
		let overflow = false, carryOut = false
		if (name === 'add' || name === 'addx') { const total = x + y + carry, signed = (x | 0) + (y | 0) + carry; result = total >>> 0; carryOut = total > 0xffffffff; overflow = signed < -2147483648 || signed > 2147483647 }
		else if (name === 'sub' || name === 'subx') { const signed = (x | 0) - (y | 0) - carry; result = x - y - carry >>> 0; carryOut = x < y + carry; overflow = signed < -2147483648 || signed > 2147483647 }
		else if (name === 'and') result = x & y
		else if (name === 'andn') result = x & ~y
		else if (name === 'or') result = x | y
		else if (name === 'orn') result = x | ~y
		else if (name === 'xor') result = x ^ y
		else if (name === 'xnor') result = ~(x ^ y)
		else if (name === 'sll') result = x << (y & 31)
		else if (name === 'srl') result = x >>> (y & 31)
		else if (name === 'sra') result = (x | 0) >> (y & 31)
		else if (name.includes('mul')) { const product = BigInt(name === 'smul' ? x | 0 : x) * BigInt(name === 'smul' ? y | 0 : y); result = Number(BigInt.asUintN(32, product)); c.r[Y] = Number(BigInt.asUintN(32, product >> 32n)) }
		else {
			if (!y) throw new Error('SPARC division by zero')
			const dividend = BigInt(c.r[Y]) << 32n | BigInt(x), signed = name === 'sdiv', quotient = (signed ? BigInt.asIntN(64, dividend) : dividend) / BigInt(signed ? y | 0 : y)
			const min = signed ? -2147483648n : 0n, max = signed ? 2147483647n : 4294967295n
			overflow = quotient < min || quotient > max; result = Number(quotient < min ? min : quotient > max ? max : quotient)
		}
		setRegister(c, d, result); if (cc) flags(c, result, overflow, carryOut)
	})
}
