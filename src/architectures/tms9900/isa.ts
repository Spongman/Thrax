import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'

export const WP = 16, ST = 17
const LGT = 0x8000, AGT = 0x4000, EQ = 0x2000, C = 0x1000, OV = 0x0800, OP = 0x0400, X = 0x0200
const dual: Record<string, number> = { szc: 0x4000, szcb: 0x5000, s: 0x6000, sb: 0x7000, c: 0x8000, cb: 0x9000, a: 0xa000, ab: 0xb000, mov: 0xc000, movb: 0xd000, soc: 0xe000, socb: 0xf000 }
const single: Record<string, number> = { blwp: 0x0400, b: 0x0440, clr: 0x04c0, neg: 0x0500, inv: 0x0540, inc: 0x0580, inct: 0x05c0, dec: 0x0600, dect: 0x0640, bl: 0x0680, swpb: 0x06c0, seto: 0x0700, abs: 0x0740 }
const immediate: Record<string, number> = { li: 0x0200, ai: 0x0220, andi: 0x0240, ori: 0x0260, ci: 0x0280 }
const format3: Record<string, number> = { coc: 0x2000, czc: 0x2400, xor: 0x2800, xop: 0x2c00, mpy: 0x3800, div: 0x3c00 }
const shifts: Record<string, number> = { sra: 0x0800, srl: 0x0900, sla: 0x0a00, src: 0x0b00 }
const jumps: Record<string, number> = { jmp: 0x1000, jlt: 0x1100, jle: 0x1200, jeq: 0x1300, jhe: 0x1400, jgt: 0x1500, jne: 0x1600, jnc: 0x1700, joc: 0x1800, jno: 0x1900, jl: 0x1a00, jh: 0x1b00, jop: 0x1c00 }
export const instructions = [...Object.keys(dual), ...Object.keys(single), ...Object.keys(immediate), ...Object.keys(format3), ...Object.keys(shifts), ...Object.keys(jumps), 'stwp', 'stst', 'lwpi', 'limi', 'rtwp', 'idle', 'rt', 'nop']
const signed = (v: number) => v << 16 >> 16
function reg(text: string): number { const m = /^r?(\d+)$/i.exec(text.trim()); if (!m || +m[1] > 15) throw new Error(`Expected TMS9900 register R0–R15, got ${text}`); return +m[1] }
function integer(v: number, min: number, max: number): number { if (!Number.isInteger(v) || v < min || v > max) throw new Error(`Value must be ${min} through ${max}`); return v }
const words = (...v: number[]) => v.flatMap(n => [n >>> 8 & 255, n & 255])
function operand(text: string, c?: CpuEncodingContext): { code: number, extension: number[] } {
	const t = text.trim(), register = /^r?\d+$/i.test(t)
	if (register) return { code: reg(t), extension: [] }
	const indirect = /^\*(r?\d+)(\+)?$/i.exec(t)
	if (indirect) return { code: (indirect[2] ? 0x30 : 0x10) | reg(indirect[1]), extension: [] }
	const indexed = /^@([^()]+)(?:\((r?\d+)\))?$/i.exec(t)
	if (!indexed) throw new Error(`Expected register, *Rn, *Rn+, @address or @offset(Rn), got ${text}`)
	if (indexed[2] && reg(indexed[2]) === 0) throw new Error('R0 cannot be an indexed base; use @address for symbolic addressing')
	return { code: 0x20 | (indexed[2] ? reg(indexed[2]) : 0), extension: [c ? integer(c.value(indexed[1]), -32768, 65535) : 0] }
}
export function instructionSize(mnemonic: string, operands: readonly string[]): number {
	const m = mnemonic.toLowerCase()
	if (m in immediate || m === 'lwpi' || m === 'limi') return 4
	if (m in dual) return 2 + operand(operands[0]).extension.length * 2 + operand(operands[1]).extension.length * 2
	if (m in single || m in format3) return 2 + operand(operands[0]).extension.length * 2
	if (!instructions.includes(m)) throw new Error(`Unsupported TMS9900 instruction ${mnemonic}`)
	return 2
}
export function encode(mnemonic: string, o: readonly string[], c: CpuEncodingContext): number[] {
	const m = mnemonic.toLowerCase(), count = (n: number) => { if (o.length !== n) throw new Error(`${m} expects ${n} operands`) }
	if (m in dual) { count(2); const s = operand(o[0], c), d = operand(o[1], c); return words(dual[m] | d.code << 6 | s.code, ...s.extension, ...d.extension) }
	if (m in single) { count(1); const s = operand(o[0], c); return words(single[m] | s.code, ...s.extension) }
	if (m in immediate) { count(2); return words(immediate[m] | reg(o[0]), integer(c.value(o[1]), -32768, 65535)) }
	if (m in format3) { count(2); const s = operand(o[0], c), d = m === 'xop' ? integer(c.value(o[1]), 0, 15) : reg(o[1]); if ((m === 'mpy' || m === 'div') && d === 15) throw new Error('Register pair must start at R0–R14'); return words(format3[m] | d << 6 | s.code, ...s.extension) }
	if (m in shifts) { count(2); return words(shifts[m] | integer(c.value(o[1]), 0, 15) << 4 | reg(o[0])) }
	if (m in jumps) { count(1); const delta = c.value(o[0]) - c.address - 2; if (delta & 1) throw new Error('Jump target must be word aligned'); integer(delta / 2, -128, 127); return words(jumps[m] | delta / 2 & 255) }
	if (m === 'stwp' || m === 'stst') { count(1); return words((m === 'stwp' ? 0x02a0 : 0x02c0) | reg(o[0])) }
	if (m === 'lwpi' || m === 'limi') { count(1); return words(m === 'lwpi' ? 0x02e0 : 0x0300, integer(c.value(o[0]), -32768, 65535)) }
	if (['rt', 'nop', 'rtwp', 'idle'].includes(m)) { count(0); return words(({ rt: 0x045b, nop: 0x1000, rtwp: 0x0380, idle: 0x0340 })[m]!) }
	throw new Error(`Unsupported TMS9900 instruction ${mnemonic}`)
}

export function getRegister(c: CpuContext, index: number): number { return index < 16 ? c.read((c.r[WP] + index * 2) & 65535, 2, false) : c.r[index] }
export function setRegister(c: CpuContext, index: number, value: number): void { if (index < 16) c.write((c.r[WP] + index * 2) & 65535, value, 2, false); else c.r[index] = value & (index === WP ? 65534 : 65535) }
function word(c: CpuContext, a: number): number { return c.read(a & 65534, 2, false) }
function write(c: CpuContext, a: number, v: number, bytes = 2): void { c.write(a & (bytes === 2 ? 65534 : 65535), v, bytes, false) }
function read(c: CpuContext, a: number, bytes = 2): number { return c.read(a & (bytes === 2 ? 65534 : 65535), bytes, false) }
function effective(c: CpuContext, code: number, extension: number): number {
	const mode = code >>> 4, r = code & 15
	return mode === 0 ? c.r[WP] + r * 2 & 65535 : mode === 2 ? (extension + (r ? getRegister(c, r) : 0)) & 65535 : getRegister(c, r)
}
function increment(c: CpuContext, code: number, width: number): void { if (code >>> 4 === 3) setRegister(c, code & 15, getRegister(c, code & 15) + width) }
function flags(c: CpuContext, value: number, width = 2, parity = false): void {
	const mask = width === 1 ? 255 : 65535, sign = width === 1 ? 128 : 32768, v = value & mask
	c.r[ST] = c.r[ST] & ~0xe000 | (v ? LGT : EQ) | (v && !(v & sign) ? AGT : 0)
	if (parity) { let bits = v, odd = false; while (bits) { odd = !odd; bits &= bits - 1 } c.r[ST] = c.r[ST] & ~OP | (odd ? OP : 0) }
}
function compare(c: CpuContext, source: number, dest: number, width = 2): void {
	const sign = width === 1 ? 128 : 32768, lhs = source & sign ? source - sign * 2 : source, rhs = dest & sign ? dest - sign * 2 : dest
	c.r[ST] = c.r[ST] & ~0xe000 | (source > dest ? LGT : 0) | (lhs > rhs ? AGT : 0) | (source === dest ? EQ : 0)
	if (width === 1) { let bits = source, odd = false; while (bits) { odd = !odd; bits &= bits - 1 } c.r[ST] = c.r[ST] & ~OP | (odd ? OP : 0) }
}
function arithmetic(c: CpuContext, lhs: number, rhs: number, subtract: boolean, width = 2): number {
	const mask = width === 1 ? 255 : 65535, sign = (mask + 1) / 2, result = lhs + (subtract ? (rhs ^ mask) + 1 : rhs), value = result & mask
	c.r[ST] = c.r[ST] & ~(C | OV) | (result > mask ? C : 0) | ((subtract ? (lhs ^ rhs) & (lhs ^ value) : ~(lhs ^ rhs) & (lhs ^ value)) & sign ? OV : 0)
	flags(c, value, width, width === 1)
	return value
}
function jumpCondition(c: CpuContext, opcode: number): boolean {
	const st = c.r[ST]
	return opcode === 0x10 || opcode === 0x11 && !(st & (AGT | EQ)) || opcode === 0x12 && (!(st & LGT) || !!(st & EQ)) || opcode === 0x13 && !!(st & EQ) || opcode === 0x14 && !!(st & (LGT | EQ)) || opcode === 0x15 && !!(st & AGT) || opcode === 0x16 && !(st & EQ) || opcode === 0x17 && !(st & C) || opcode === 0x18 && !!(st & C) || opcode === 0x19 && !(st & OV) || opcode === 0x1a && !(st & (LGT | EQ)) || opcode === 0x1b && !!(st & LGT) && !(st & EQ) || opcode === 0x1c && !!(st & OP)
}
function monitor(c: CpuContext): void {
	const argument = getRegister(c, 1)
	switch (getRegister(c, 0)) {
		case 1: c.output(String(signed(argument))); break
		case 4: { let a = argument, text = ''; while (a < c.memory.length && c.memory[a]) text += String.fromCharCode(c.read(a++, 1)); c.output(text); break }
		case 5: setRegister(c, 1, c.inputInteger(16)); break
		case 10: c.halt(); break
		case 11: c.output(String.fromCharCode(argument & 255)); break
		default: throw new Error(`Unsupported TMS9900 educational monitor service ${getRegister(c, 0)}`)
	}
}
export function decode(bytes: Uint8Array, address: number): CpuInstruction {
	const w = (a: number) => { const high = a & 65535, low = a + 1 & 65535; if (high >= bytes.length || low >= bytes.length) throw new Error('TMS9900 instruction outside memory'); return bytes[high] << 8 | bytes[low] }
	if (address & 1) throw new Error('Unaligned TMS9900 instruction')
	const opcode = w(address), s = opcode & 63, d = opcode >>> 6 & 63, r = opcode & 15
	let size = 2
	const hasSource = opcode >= 0x4000 || opcode >= 0x2000 && opcode < 0x4000 || Object.values(single).includes(opcode & 0xffc0)
	const sourceExtension = hasSource && s >>> 4 === 2 ? (size += 2, w(address + 2)) : 0
	const reads: string[] = [], writes: string[] = []
	const rd = (...indices: number[]) => reads.push(...indices.map(i => i < 16 ? `r${i}` : i === WP ? 'wp' : 'st'))
	const wr = (...indices: number[]) => writes.push(...indices.map(i => i < 16 ? `r${i}` : i === WP ? 'wp' : 'st'))
	const resource = (code: number, readValue: boolean, writeValue: boolean) => {
		const mode = code >>> 4, index = code & 15
		rd(WP)
		if (mode === 0) { if (readValue) rd(index); if (writeValue) wr(index) }
		else { if (mode !== 2 || index) rd(index); if (mode === 3) wr(index) }
	}
	if (opcode >= 0x4000) { const compareOnly = (opcode & 0xe000) === 0x8000; resource(s, true, false); resource(d, true, !compareOnly); rd(ST); wr(ST) }
	else if (opcode >= 0x2000 && opcode < 0x4000) {
		const base = opcode & 0xfc00, dest = opcode >>> 6 & 15
		resource(s, base !== 0x2c00, false)
		if (base === 0x2c00) { rd(0, 1, ST); wr(WP, ST, 1, 11, 13, 14, 15) }
		else { rd(dest); if (base === 0x3800 || base === 0x3c00) { wr(dest, dest + 1); if (base === 0x3c00) { rd(dest + 1, ST); wr(ST) } } else { rd(ST); wr(ST); if (base === 0x2800) wr(dest) } }
	} else if (opcode >= 0x1000 && opcode < 0x1d00) { if ((opcode & 0xff00) !== 0x1000) rd(ST) }
	else if (opcode >= 0x0800 && opcode < 0x0c00) { rd(WP, ST, r); if (!(opcode & 0xf0)) rd(0); wr(r, ST) }
	else if (Object.values(single).includes(opcode & 0xffc0)) {
		const base = opcode & 0xffc0, branch = [0x0400, 0x0440, 0x0680].includes(base)
		resource(s, !branch, !branch)
		if (base === 0x0400) { rd(ST); wr(WP, 13, 14, 15) }
		else if (base === 0x0680) wr(11)
		else if (![0x0440, 0x04c0, 0x0700, 0x06c0].includes(base)) { rd(ST); wr(ST) }
	} else if (Object.values(immediate).includes(opcode & 0xfff0)) { rd(WP, ST); if ((opcode & 0xfff0) !== 0x0200) rd(r); if ((opcode & 0xfff0) !== 0x0280) wr(r); wr(ST) }
	else if ((opcode & 0xfff0) === 0x02a0 || (opcode & 0xfff0) === 0x02c0) { rd(WP); rd((opcode & 0xfff0) === 0x02a0 ? WP : ST); wr(r) }
	else if (opcode === 0x02e0) wr(WP)
	else if (opcode === 0x0300) { rd(ST); wr(ST) }
	else if (opcode === 0x0380) { rd(WP, 13, 14, 15); wr(WP, ST) }
	const make = (text: string, execute: (c: CpuContext) => void, extra?: Partial<CpuInstruction>): CpuInstruction => ({ size, text, execute, kind: 'alu', reads, writes, ...extra })
	const text = (code: number, ext: number) => code >>> 4 === 0 ? `R${code & 15}` : code >>> 4 === 1 ? `*R${code & 15}` : code >>> 4 === 3 ? `*R${code & 15}+` : `@>${ext.toString(16)}${code & 15 ? `(R${code & 15})` : ''}`
	if (opcode >= 0x4000) {
		const name = Object.keys(dual).find(n => dual[n] === (opcode & 0xf000))!, width = opcode & 0x1000 ? 1 : 2, de = d >>> 4 === 2 ? (size += 2, w(address + size - 2)) : 0
		return make(`${name} ${text(s, sourceExtension)}, ${text(d, de)}`, c => {
			const sa = effective(c, s, sourceExtension), sv = read(c, sa, width)
			increment(c, s, width)
			const da = effective(c, d, de), dv = read(c, da, width)
			increment(c, d, width)
			if (name === 'c' || name === 'cb') { compare(c, sv, dv, width); return }
			const value = name === 'a' || name === 'ab' ? arithmetic(c, dv, sv, false, width) : name === 's' || name === 'sb' ? arithmetic(c, dv, sv, true, width) : name === 'mov' || name === 'movb' ? sv : name === 'soc' || name === 'socb' ? dv | sv : dv & ~sv
			if (!['a', 'ab', 's', 'sb'].includes(name)) flags(c, value, width, width === 1)
			write(c, da, value, width)
		}, { kind: name.startsWith('mov') ? d >>> 4 ? 'store' : 'load' : 'alu' })
	}
	if (opcode >= 0x2000 && opcode < 0x4000) {
		const base = opcode & 0xfc00, name = Object.keys(format3).find(n => format3[n] === base), target = opcode >>> 6 & 15
		if (!name || (name === 'mpy' || name === 'div') && target === 15) throw new Error(`Unsupported TMS9900 instruction >${opcode.toString(16)}`)
		return make(`${name} ${text(s, sourceExtension)}, ${name === 'xop' ? target : `R${target}`}`, c => {
			const sa = effective(c, s, sourceExtension)
			if (name === 'xop') {
				increment(c, s, 2)
				if (target === 15 && !word(c, 0x7c) && !word(c, 0x7e)) { monitor(c); return }
				const nextWp = word(c, 0x40 + target * 4), nextPc = word(c, 0x42 + target * 4), oldWp = c.r[WP], oldPc = c.pc, oldSt = c.r[ST]
				c.r[WP] = nextWp & 65534
				setRegister(c, 11, sa); setRegister(c, 13, oldWp); setRegister(c, 14, oldPc); setRegister(c, 15, oldSt)
				c.r[ST] |= X; c.call(nextPc & 65534); return
			}
			const value = read(c, sa), dest = getRegister(c, target)
			increment(c, s, 2)
			if (name === 'mpy') { const product = value * dest; setRegister(c, target, Math.floor(product / 65536)); setRegister(c, target + 1, product & 65535) }
			else if (name === 'div') { if (value <= dest) c.r[ST] |= OV; else { const dividend = dest * 65536 + getRegister(c, target + 1); setRegister(c, target, Math.floor(dividend / value)); setRegister(c, target + 1, dividend % value); c.r[ST] &= ~OV } }
			else if (name === 'xor') { setRegister(c, target, value ^ dest); flags(c, value ^ dest) }
			else c.r[ST] = c.r[ST] & ~EQ | ((name === 'coc' ? value & dest : value & ~dest) === value ? EQ : 0)
		}, { call: name === 'xop', kind: name === 'xop' ? 'system' : 'alu' })
	}
	if (opcode >= 0x1000 && opcode < 0x1d00) { size = 2; const base = opcode >>> 8, name = Object.keys(jumps).find(n => jumps[n] >>> 8 === base)!, target = address + 2 + (opcode << 24 >> 24) * 2 & 65535; return make(`${name} >${target.toString(16)}`, c => c.branch(target, jumpCondition(c, base)), { kind: 'branch' }) }
	if (opcode >= 0x0800 && opcode < 0x0c00) { size = 2; const base = opcode & 0x0f00, name = Object.keys(shifts).find(n => shifts[n] === base)!, encodedCount = opcode >>> 4 & 15; return make(`${name} R${r}, ${encodedCount}`, c => { const n = encodedCount || (getRegister(c, 0) & 15) || 16; let value = getRegister(c, r), carry = false, overflow = false; for (let i = 0; i < n; i++) { if (name === 'sla') { carry = !!(value & 0x8000); const next = value << 1 & 65535; overflow ||= !!((next ^ value) & 0x8000); value = next } else { carry = !!(value & 1); value = value >>> 1 | (name === 'sra' ? value & 0x8000 : name === 'src' && carry ? 0x8000 : 0) } } setRegister(c, r, value); flags(c, value); c.r[ST] = c.r[ST] & ~C | (carry ? C : 0); if (name === 'sla') c.r[ST] = c.r[ST] & ~OV | (overflow ? OV : 0) }) }
	const singleName = Object.keys(single).find(n => single[n] === (opcode & 0xffc0))
	if (singleName) return make(`${singleName} ${text(s, sourceExtension)}`, c => {
		const ea = effective(c, s, sourceExtension)
		if (singleName === 'b' || singleName === 'bl') { increment(c, s, 2); if (singleName === 'bl') { setRegister(c, 11, c.pc); c.call(ea & 65534) } else if (s === 0x1b) c.ret(ea & 65534); else c.branch(ea & 65534, true); return }
		if (singleName === 'blwp') { increment(c, s, 2); const nextWp = word(c, ea), nextPc = word(c, ea + 2), oldWp = c.r[WP], oldPc = c.pc, oldSt = c.r[ST]; c.r[WP] = nextWp & 65534; setRegister(c, 13, oldWp); setRegister(c, 14, oldPc); setRegister(c, 15, oldSt); c.call(nextPc & 65534); return }
		const value = read(c, ea)
		increment(c, s, 2)
		let result: number
		if (singleName === 'clr') result = 0
		else if (singleName === 'seto') result = 65535
		else if (singleName === 'swpb') result = value << 8 | value >>> 8
		else if (singleName === 'inv') { result = value ^ 65535; flags(c, result) }
		else if (singleName === 'neg') result = arithmetic(c, 0, value, true)
		else if (singleName === 'abs') { flags(c, value); c.r[ST] = c.r[ST] & ~OV | (value === 0x8000 ? OV : 0); result = value & 0x8000 ? -value : value }
		else result = arithmetic(c, value, singleName === 'inct' || singleName === 'dect' ? 2 : 1, singleName === 'dec' || singleName === 'dect')
		write(c, ea, result)
	}, { call: singleName === 'bl' || singleName === 'blwp', kind: singleName === 'bl' || singleName === 'blwp' ? 'call' : singleName === 'b' ? s === 0x1b ? 'return' : 'jump' : 'alu' })
	const immName = Object.keys(immediate).find(n => immediate[n] === (opcode & 0xfff0))
	if (immName) { size = 4; const value = w(address + 2); return make(`${immName} R${r}, >${value.toString(16)}`, c => { const previous = getRegister(c, r); if (immName === 'ci') { compare(c, previous, value); return } const result = immName === 'li' ? value : immName === 'ai' ? arithmetic(c, previous, value, false) : immName === 'andi' ? previous & value : previous | value; setRegister(c, r, result); if (immName !== 'ai') flags(c, result) }) }
	if ((opcode & 0xfff0) === 0x02a0 || (opcode & 0xfff0) === 0x02c0) { size = 2; const wp = (opcode & 0xfff0) === 0x02a0; return make(`${wp ? 'stwp' : 'stst'} R${r}`, c => setRegister(c, r, c.r[wp ? WP : ST])) }
	if (opcode === 0x02e0 || opcode === 0x0300) { size = 4; const value = w(address + 2); return make(`${opcode === 0x02e0 ? 'lwpi' : 'limi'} >${value.toString(16)}`, c => { if (opcode === 0x02e0) c.r[WP] = value & 65534; else c.r[ST] = c.r[ST] & 65520 | value & 15 }) }
	if (opcode === 0x0380) { size = 2; return make('rtwp', c => { const oldWp = getRegister(c, 13), pc = getRegister(c, 14), st = getRegister(c, 15); c.r[WP] = oldWp & 65534; c.r[ST] = st; c.ret(pc & 65534) }, { kind: 'return' }) }
	if (opcode === 0x0340) { size = 2; return make('idle', c => c.halt(), { kind: 'system' }) }
	throw new Error(`Unsupported TMS9900 instruction >${opcode.toString(16).padStart(4, '0')}`)
}
