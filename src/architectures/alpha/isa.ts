import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'
import { FP, FPCR, FPCR_MASK, executeFloat, floatBranch, floatCondition, floatInstructions, floatMemory, floatOperate, floatOperateByWord, floatShape, registerToS, sToRegister } from './float'

const operate: Record<string, [number, number]> = {
	addl: [0x10, 0x00], s4addl: [0x10, 0x02], subl: [0x10, 0x09], s4subl: [0x10, 0x0b], cmpbge: [0x10, 0x0f], s8addl: [0x10, 0x12], s8subl: [0x10, 0x1b], cmpult: [0x10, 0x1d], addq: [0x10, 0x20], s4addq: [0x10, 0x22], subq: [0x10, 0x29], s4subq: [0x10, 0x2b], cmpeq: [0x10, 0x2d], s8addq: [0x10, 0x32], s8subq: [0x10, 0x3b], cmpule: [0x10, 0x3d], 'addl/v': [0x10, 0x40], cmplt: [0x10, 0x4d], 'subl/v': [0x10, 0x49], 'addq/v': [0x10, 0x60], 'subq/v': [0x10, 0x69], cmple: [0x10, 0x6d],
	and: [0x11, 0x00], bic: [0x11, 0x08], cmovlbs: [0x11, 0x14], cmovlbc: [0x11, 0x16], bis: [0x11, 0x20], cmoveq: [0x11, 0x24], cmovne: [0x11, 0x26], ornot: [0x11, 0x28], xor: [0x11, 0x40], cmovlt: [0x11, 0x44], cmovge: [0x11, 0x46], eqv: [0x11, 0x48], cmovle: [0x11, 0x64], cmovgt: [0x11, 0x66],
	srl: [0x12, 0x34], sll: [0x12, 0x39], sra: [0x12, 0x3c], zap: [0x12, 0x30], zapnot: [0x12, 0x31], extbl: [0x12, 0x06], extwl: [0x12, 0x16], extll: [0x12, 0x26], extql: [0x12, 0x36], insbl: [0x12, 0x0b], inswl: [0x12, 0x1b], insll: [0x12, 0x2b], insql: [0x12, 0x3b], mskbl: [0x12, 0x02], mskwl: [0x12, 0x12], mskll: [0x12, 0x22], mskql: [0x12, 0x32],
	mull: [0x13, 0x00], mulq: [0x13, 0x20], umulh: [0x13, 0x30], 'mull/v': [0x13, 0x40], 'mulq/v': [0x13, 0x60],
}
const memory: Record<string, number> = { lda: 0x08, ldah: 0x09, ldbu: 0x0a, ldq_u: 0x0b, ldwu: 0x0c, stw: 0x0d, stb: 0x0e, stq_u: 0x0f, ldl: 0x28, ldq: 0x29, stl: 0x2c, stq: 0x2d }
const branch: Record<string, number> = { br: 0x30, bsr: 0x34, blbc: 0x38, beq: 0x39, blt: 0x3a, ble: 0x3b, blbs: 0x3c, bne: 0x3d, bge: 0x3e, bgt: 0x3f }
const barriers: Record<string, number> = { trapb: 0, excb: 0x0400, mb: 0x4000, wmb: 0x4400 }
const aliases: Record<string, number> = { v0: 0, t0: 1, t1: 2, t2: 3, t3: 4, t4: 5, t5: 6, t6: 7, t7: 8, s0: 9, s1: 10, s2: 11, s3: 12, s4: 13, s5: 14, s6: 15, fp: 15, a0: 16, a1: 17, a2: 18, a3: 19, a4: 20, a5: 21, t8: 22, t9: 23, t10: 24, t11: 25, ra: 26, pv: 27, at: 28, gp: 29, sp: 30, zero: 31 }
export const instructions = [...Object.keys(operate), ...Object.keys(memory), ...Object.keys(branch), ...Object.keys(barriers), 'jmp', 'jsr', 'ret', 'jsr_coroutine', 'call_pal', 'mov', 'clr', 'nop', 'not', 'negl', 'negq', ...floatInstructions]
function freg(text: string): number {
	const m = /^\$?f(\d+)$/i.exec(text.trim())
	if (!m || +m[1] > 31) throw new Error(`Expected an Alpha floating-point register $f0–$f31, got ${text}`)
	return +m[1]
}
function reg(text: string): number {
	const name = text.trim().replace(/^\$/, '').toLowerCase()
	if (name in aliases) return aliases[name]
	const m = /^(?:r)?(\d+)$/.exec(name)
	if (!m || +m[1] > 31) throw new Error(`Expected an Alpha integer register $0–$31, got ${text}`)
	return +m[1]
}
function integer(n: number, min: number, max: number, what: string): number {
	if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${what} must be ${min} through ${max}`)
	return n
}
const bytes = (w: number) => [w & 255, w >>> 8 & 255, w >>> 16 & 255, w >>> 24]
function mem(text: string, c: CpuEncodingContext): [number, number] {
	const m = /^(.*?)\(([^()]+)\)$/.exec(text)
	if (!m) return [integer(c.value(text), -32768, 32767, 'Displacement'), 31]
	return [integer(c.value(m[1] || '0'), -32768, 32767, 'Displacement'), reg(m[2])]
}
function displacement(target: number, c: CpuEncodingContext): number {
	const delta = target - c.address - 4
	if (delta & 3) throw new Error('Alpha branch target must be word aligned')
	integer(delta / 4, -1048576, 1048575, 'Branch displacement')
	return delta / 4 & 0x1fffff
}
export function encode(mnemonic: string, operands: readonly string[], c: CpuEncodingContext): number[] {
	let m = mnemonic.toLowerCase(), o = [...operands]
	if (!instructions.includes(m)) throw new Error(`Unsupported Alpha instruction ${mnemonic}`)
	const count = (n: number) => { if (o.length !== n) throw new Error(`${m} expects ${n} operands`) }
	if (m === 'nop') { count(0); m = 'bis'; o = ['$31', '$31', '$31'] }
	if (m === 'mov') { count(2); m = 'bis'; o = ['$31', o[0], o[1]] }
	if (m === 'clr') { count(1); m = 'bis'; o = ['$31', '$31', o[0]] }
	if (m === 'not') { count(2); m = 'ornot'; o = ['$31', o[0], o[1]] }
	if (m === 'negl' || m === 'negq') { count(2); m = m === 'negl' ? 'subl' : 'subq'; o = ['$31', o[0], o[1]] }
	if (m in operate) {
		count(3)
		const [op, fn] = operate[m], a = reg(o[0]), dest = reg(o[2]), token = o[1].trim()
		let literal = false, b: number
		if (/^\$|^r\d+$|^[a-z][a-z\d]*$/i.test(token) && (token.replace(/^\$/, '').toLowerCase() in aliases || /^\$?\d+$|^\$?r\d+$/i.test(token))) b = reg(token)
		else { literal = true; b = integer(c.value(token.replace(/^#/, '')), 0, 255, 'Operate literal') }
		return bytes(op << 26 | a << 21 | b << (literal ? 13 : 16) | +literal << 12 | fn << 5 | dest)
	}
	if (m in memory) { count(2); const [disp, base] = mem(o[1], c); return bytes(memory[m] << 26 | reg(o[0]) << 21 | base << 16 | disp & 65535) }
	if (m in branch) {
		if ((m === 'br' || m === 'bsr') && o.length === 1) o.unshift(m === 'br' ? '$31' : '$26')
		count(2)
		return bytes(branch[m] << 26 | reg(o[0]) << 21 | displacement(c.value(o[1]), c))
	}
	if (m === 'fmov' || m === 'fneg') { count(2); m = m === 'fmov' ? 'cpys' : 'cpysn'; o = [o[0], o[0], o[1]] }
	if (m === 'fabs') { count(2); m = 'cpys'; o = ['$f31', o[0], o[1]] }
	if (m === 'fclr') { count(1); m = 'cpys'; o = ['$f31', '$f31', o[0]] }
	if (m === 'fnop') { count(0); m = 'cpys'; o = ['$f31', '$f31', '$f31'] }
	const float = floatOperate.get(m)
	if (float) {
		const shape = floatShape(m)
		let a = 31, b = 31, dest: number
		if (shape === 'binary') { count(3); a = freg(o[0]); b = freg(o[1]); dest = freg(o[2]) }
		else if (shape === 'unary') { count(2); b = freg(o[0]); dest = freg(o[1]) }
		else if (shape === 'fpcr') { count(1); a = b = dest = freg(o[0]) }
		else if (shape === 'itof') { count(2); a = reg(o[0]); dest = freg(o[1]) }
		else { count(2); a = freg(o[0]); dest = reg(o[1]) }
		return bytes(float[0] << 26 | a << 21 | b << 16 | float[1] << 5 | dest)
	}
	if (m in floatMemory) { count(2); const [disp, base] = mem(o[1], c); return bytes(floatMemory[m] << 26 | freg(o[0]) << 21 | base << 16 | disp & 65535) }
	if (m in floatBranch) { count(2); return bytes(floatBranch[m] << 26 | freg(o[0]) << 21 | displacement(c.value(o[1]), c)) }
	if (['jmp', 'jsr', 'ret', 'jsr_coroutine'].includes(m)) {
		if (m === 'ret' && o.length === 0) o = ['$31', '($26)', '1']
		if (o.length < 2 || o.length > 3) throw new Error(`${m} expects destination, (target register), optional hint`)
		const target = /^\(([^()]+)\)$/.exec(o[1])
		if (!target) throw new Error('Expected (target register)')
		const fn = { jmp: 0, jsr: 1, ret: 2, jsr_coroutine: 3 }[m]!
		return bytes(0x1a << 26 | reg(o[0]) << 21 | reg(target[1]) << 16 | fn << 14 | (o[2] ? integer(c.value(o[2]), 0, 16383, 'Branch hint') : 0))
	}
	if (m === 'call_pal') { count(1); return bytes(integer(c.value(o[0]), 0, 0x3ffffff, 'PAL function')) }
	if (m in barriers) { count(0); return bytes(0x18 << 26 | barriers[m]) }
	throw new Error(`Unsupported Alpha instruction ${mnemonic}`)
}
const unsigned = (n: bigint) => BigInt.asUintN(64, n)
const signed = (n: bigint) => BigInt.asIntN(64, n)
function get(c: CpuContext, index: number): bigint { return index === 31 ? 0n : c.w[index] }
function put(c: CpuContext, index: number, value: bigint): void { if (index !== 31) c.w[index] = unsigned(value) }
function fget(c: CpuContext, index: number): bigint { return index === 31 ? 0n : c.w[FP + index] }
function fput(c: CpuContext, index: number, value: bigint): void { if (index !== 31) c.w[FP + index] = value }
function operateValue(name: string, a: bigint, b: bigint, previous: bigint): bigint {
	const base = name.replace('/v', ''), long = ['addl', 'subl', 's4addl', 's8addl', 's4subl', 's8subl', 'mull'].includes(base), as = long ? BigInt.asIntN(32, a) : signed(a), bs = long ? BigInt.asIntN(32, b) : signed(b)
	let result = 0n
	if (base.startsWith('cmov')) {
		const condition = base === 'cmoveq' ? a === 0n : base === 'cmovne' ? a !== 0n : base === 'cmovlt' ? as < 0n : base === 'cmovle' ? as <= 0n : base === 'cmovgt' ? as > 0n : base === 'cmovge' ? as >= 0n : base === 'cmovlbs' ? !!(a & 1n) : !(a & 1n)
		return condition ? b : previous
	}
	if (['addl', 'addq', 's4addl', 's8addl', 's4addq', 's8addq', 'subl', 'subq', 's4subl', 's8subl', 's4subq', 's8subq'].includes(base)) { const scale = base.startsWith('s4') ? 4n : base.startsWith('s8') ? 8n : 1n; result = as * scale + (base.includes('sub') ? -bs : bs) }
	else if (base === 'mull' || base === 'mulq') result = as * bs
	else if (base === 'umulh') result = a * b >> 64n
	else if (base === 'and') result = a & b
	else if (base === 'bic') result = a & ~b
	else if (base === 'bis') result = a | b
	else if (base === 'ornot') result = a | ~b
	else if (base === 'xor') result = a ^ b
	else if (base === 'eqv') result = ~(a ^ b)
	else if (base === 'sll') result = a << (b & 63n)
	else if (base === 'srl') result = a >> (b & 63n)
	else if (base === 'sra') result = as >> (b & 63n)
	else if (base.startsWith('cmp')) {
		if (base === 'cmpbge') { for (let i = 0n; i < 8n; i++) if ((a >> i * 8n & 255n) >= (b >> i * 8n & 255n)) result |= 1n << i }
		else result = BigInt(base === 'cmpeq' ? a === b : base === 'cmplt' ? as < bs : base === 'cmple' ? as <= bs : base === 'cmpult' ? a < b : a <= b)
	} else if (base === 'zap' || base === 'zapnot') { for (let i = 0n; i < 8n; i++) if (Boolean(b & 1n << i) === (base === 'zapnot')) result |= a & 255n << i * 8n }
	else if (/^(ext|ins|msk)[bwlq]l$/.test(base)) {
		const width = ({ b: 8, w: 16, l: 32, q: 64 })[base[3]]!, shift = (b & 7n) * 8n, mask = (1n << BigInt(width)) - 1n
		result = base.startsWith('ext') ? a >> shift & mask : base.startsWith('ins') ? (a & mask) << shift : a & ~(mask << shift)
	} else throw new Error(`Unsupported Alpha operation ${name}`)
	const bits = long ? 32 : 64
	if (name.endsWith('/v') && (result < -(1n << BigInt(bits - 1)) || result >= 1n << BigInt(bits - 1))) throw new Error('Alpha integer overflow')
	return long ? BigInt.asIntN(32, result) : result
}
function consoleCall(c: CpuContext): void {
	switch (Number(get(c, 0))) {
		case 1: c.output(signed(get(c, 16)).toString()); break
		case 4: { let text = '', a = Number(get(c, 16)); while (a < c.memory.length && c.memory[a]) text += String.fromCharCode(c.read(a++, 1)); c.output(text); break }
		case 5: put(c, 0, BigInt(c.inputInteger(32))); break
		case 10: c.halt(); break
		case 11: c.output(String.fromCharCode(Number(get(c, 16) & 255n))); break
		default: throw new Error(`Unsupported educational CALL_PAL callsys service ${get(c, 0)}`)
	}
}
export function decode(bytes: Uint8Array, address: number): CpuInstruction {
	if (address & 3 || address + 4 > bytes.length) throw new Error('Unaligned or out-of-range Alpha instruction')
	const word = (bytes[address] | bytes[address + 1] << 8 | bytes[address + 2] << 16 | bytes[address + 3] << 24) >>> 0
	const op = word >>> 26, a = word >>> 21 & 31, b = word >>> 16 & 31, dest = word & 31, disp = word << 16 >> 16
	const reads: string[] = [], writes: string[] = []
	const rd = (...indices: number[]) => reads.push(...indices.filter(i => i !== 31).map(i => `r${i}`))
	const wr = (...indices: number[]) => writes.push(...indices.filter(i => i !== 31).map(i => `r${i}`))
	if (op >= 0x10 && op <= 0x13) { rd(a); if (!(word & 4096)) rd(b); wr(dest); if (op === 0x11 && (word >>> 5 & 127) >= 0x14 && ![0x20, 0x28, 0x40, 0x48].includes(word >>> 5 & 127)) rd(dest) }
	else if (Object.values(memory).includes(op)) { rd(b); if ([0x0d, 0x0e, 0x0f, 0x2c, 0x2d].includes(op)) rd(a); else wr(a) }
	else if (Object.values(branch).includes(op)) { if (op === 0x30 || op === 0x34) wr(a); else rd(a) }
	else if (op === 0x1a) { rd(b); wr(a) }
	else if (op === 0 && word === 0x83) { rd(0, 16); wr(0) }
	const frd = (...indices: number[]) => reads.push(...indices.filter(i => i !== 31).map(i => `f${i}`))
	const fwr = (...indices: number[]) => writes.push(...indices.filter(i => i !== 31).map(i => `f${i}`))
	const make = (text: string, execute: (c: CpuContext) => void, extra?: Partial<CpuInstruction>): CpuInstruction => ({ size: 4, text, execute, kind: 'alu', reads, writes, ...extra })
	const floatName = [0x14, 0x16, 0x17, 0x1c].includes(op) ? floatOperateByWord.get(op << 11 | word >>> 5 & 0x7ff) : undefined
	if (floatName) {
		const shape = floatShape(floatName), base = floatName.split('/')[0]
		if (shape === 'binary') { frd(a, b); fwr(dest); if (base.startsWith('fcmov')) frd(dest) }
		else if (shape === 'unary') { frd(b); fwr(dest) }
		else if (shape === 'itof') { rd(a); fwr(dest) }
		else if (shape === 'ftoi') { frd(a); wr(dest) }
		else if (base === 'mf_fpcr') fwr(a)
		else frd(a)
		if (op === 0x16 || op === 0x14 && shape === 'unary' || shape === 'fpcr') { reads.push('fpcr'); if (base !== 'mf_fpcr') writes.push('fpcr') }
		const text = shape === 'binary' ? `${floatName} $f${a}, $f${b}, $f${dest}` : shape === 'unary' ? `${floatName} $f${b}, $f${dest}` : shape === 'fpcr' ? `${floatName} $f${a}` : shape === 'itof' ? `${floatName} $${a}, $f${dest}` : `${floatName} $f${a}, $${dest}`
		return make(text, c => {
			if (base.startsWith('fcmov')) { if (floatCondition(base.slice(5), fget(c, a))) fput(c, dest, fget(c, b)); return }
			if (base === 'mf_fpcr') { fput(c, a, c.w[FPCR]); return }
			if (base === 'mt_fpcr') { c.w[FPCR] = fget(c, a) & FPCR_MASK; return }
			const result = executeFloat(floatName, c.w[FPCR], shape === 'itof' ? get(c, a) : fget(c, a), fget(c, b))
			c.w[FPCR] = result.fpcr
			if (shape === 'ftoi') put(c, dest, result.value)
			else fput(c, dest, result.value)
		})
	}
	const floatMem = Object.keys(floatMemory).find(n => floatMemory[n] === op)
	if (floatMem) {
		rd(b); if (floatMem.startsWith('st')) frd(a); else fwr(a)
		const single = floatMem.endsWith('s')
		return make(`${floatMem} $f${a}, ${disp}($${b})`, c => {
			const ea = Number(unsigned(get(c, b) + BigInt(disp)))
			if (!Number.isSafeInteger(ea) || ea % (single ? 4 : 8)) throw new Error('Unaligned or out-of-range Alpha data access')
			if (floatMem === 'lds') fput(c, a, sToRegister(BigInt(c.read(ea, 4, true))))
			else if (floatMem === 'ldt') fput(c, a, c.readWide(ea, true))
			else if (floatMem === 'sts') c.write(ea, Number(registerToS(fget(c, a))), 4, true)
			else c.writeWide(ea, fget(c, a), true)
		}, { kind: floatMem.startsWith('st') ? 'store' : 'load' })
	}
	const floatBr = Object.keys(floatBranch).find(n => floatBranch[n] === op)
	if (floatBr) {
		frd(a)
		const target = address + 4 + (word << 11 >> 11) * 4
		return make(`${floatBr} $f${a}, 0x${target.toString(16)}`, c => c.branch(target, floatCondition(floatBr.slice(2), fget(c, a))), { kind: 'branch' })
	}
	if (op >= 0x10 && op <= 0x13) {
		const fn = word >>> 5 & 127, name = Object.keys(operate).find(n => operate[n][0] === op && operate[n][1] === fn), literal = !!(word & 4096), value = word >>> 13 & 255
		if (!name || !literal && word & 0xe000) throw new Error(`Unsupported Alpha operate encoding 0x${word.toString(16)}`)
		return make(`${name} $${a}, ${literal ? value : `$${b}`}, $${dest}`, c => { put(c, dest, operateValue(name, get(c, a), literal ? BigInt(value) : get(c, b), get(c, dest))) })
	}
	const memName = Object.keys(memory).find(n => memory[n] === op)
	if (memName) return make(`${memName} $${a}, ${disp}($${b})`, c => {
		const wideAddress = unsigned(get(c, b) + BigInt(disp)), ea = Number(wideAddress)
		if (memName === 'lda' || memName === 'ldah') { put(c, a, get(c, b) + BigInt(disp) * (memName === 'ldah' ? 65536n : 1n)); return }
		const width = memName === 'ldbu' || memName === 'stb' ? 1 : memName === 'ldwu' || memName === 'stw' ? 2 : memName === 'ldl' || memName === 'stl' ? 4 : 8, unaligned = memName.endsWith('_u'), target = unaligned ? Math.floor(ea / 8) * 8 : ea
		if (!Number.isSafeInteger(ea) || !unaligned && ea % width) throw new Error('Unaligned or out-of-range Alpha data access')
		if (memName.startsWith('st')) { if (width === 8) c.writeWide(target, get(c, a), true); else c.write(target, Number(get(c, a) & 0xffffffffn), width, true) }
		else { const value = width === 8 ? c.readWide(target, true) : BigInt(c.read(target, width, true)); put(c, a, memName === 'ldl' ? BigInt.asIntN(32, value) : value) }
	}, { kind: memName.startsWith('st') ? 'store' : memName.startsWith('ld') && !['lda', 'ldah'].includes(memName) ? 'load' : 'alu' })
	const branchName = Object.keys(branch).find(n => branch[n] === op)
	if (branchName) {
		const target = address + 4 + (word << 11 >> 11) * 4, isCall = op === 0x34
		return make(`${branchName} $${a}, 0x${target.toString(16)}`, c => {
			const value = get(c, a), signedValue = signed(value), take = op === 0x30 || isCall || branchName === 'beq' && !value || branchName === 'bne' && !!value || branchName === 'blt' && signedValue < 0n || branchName === 'ble' && signedValue <= 0n || branchName === 'bge' && signedValue >= 0n || branchName === 'bgt' && signedValue > 0n || branchName === 'blbs' && !!(value & 1n) || branchName === 'blbc' && !(value & 1n)
			const returnAddress = c.pc
			if (op === 0x30 || isCall) put(c, a, BigInt(returnAddress))
			c.branch(target, !!take)
			if (take && isCall) c.call(target, returnAddress)
		}, { call: isCall, kind: isCall ? 'call' : 'branch' })
	}
	if (op === 0x1a) { const fn = word >>> 14 & 3; return make(`${['jmp', 'jsr', 'ret', 'jsr_coroutine'][fn]} $${a}, ($${b}), ${word & 16383}`, c => { const target = Number(get(c, b) & ~3n); if (!Number.isSafeInteger(target)) throw new Error('Alpha jump outside physical address range'); put(c, a, BigInt(c.pc)); if (fn === 1 || fn === 3) c.call(target); else if (fn === 2) c.ret(target); else c.pc = target }, { call: fn === 1 || fn === 3, kind: fn === 1 || fn === 3 ? 'call' : fn === 2 ? 'return' : 'jump' }) }
	if (op === 0) { const fn = word & 0x3ffffff; if (fn !== 0 && fn !== 0x83) throw new Error(`Unsupported Alpha PAL function 0x${fn.toString(16)}`); return make(`call_pal 0x${fn.toString(16)}`, fn === 0 ? c => c.halt() : consoleCall, { kind: 'system' }) }
	if (op === 0x18 && (word & 0xffff) in Object.fromEntries(Object.entries(barriers).map(([n, v]) => [v, n]))) return make(Object.keys(barriers).find(n => barriers[n] === (word & 65535))!, () => {})
	throw new Error(`Unsupported Alpha instruction 0x${word.toString(16).padStart(8, '0')}`)
}
