import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'
import { decodeFloat, encodeFloat, floatInstructions } from './fpu'

const CR = 32, LR = 33, CTR = 34, XER = 35
const arithmetic: Record<string, number> = { add: 266, subf: 40, mullw: 235, divw: 491, divwu: 459 }
const logical: Record<string, number> = { and: 28, andc: 60, or: 444, orc: 412, xor: 316, nor: 124, nand: 476, eqv: 284, slw: 24, srw: 536, sraw: 792 }
const memory: Record<string, number> = { lwz: 32, lwzu: 33, lbz: 34, lbzu: 35, stw: 36, stwu: 37, stb: 38, stbu: 39, lhz: 40, lhzu: 41, lha: 42, lhau: 43, sth: 44, sthu: 45 }
const indexed: Record<string, number> = { lwzx: 23, lbzx: 87, lhzx: 279, lhax: 343, stwx: 151, stbx: 215, sthx: 407 }
const conditional: Record<string, [number, number]> = { beq: [12, 2], bne: [4, 2], blt: [12, 0], bge: [4, 0], bgt: [12, 1], ble: [4, 1], bdnz: [16, 0], bdz: [18, 0] }
export const instructions = ['addi', 'addis', 'mulli', 'li', 'lis', 'la', 'mr', 'nop', 'subi', 'neg', 'not', ...Object.keys(arithmetic), ...Object.keys(arithmetic).map(x => `${x}.`), ...Object.keys(logical), ...Object.keys(logical).map(x => `${x}.`), 'ori', 'oris', 'xori', 'xoris', 'andi.', 'andis.', ...Object.keys(memory), ...Object.keys(indexed), 'cmpw', 'cmplw', 'cmpwi', 'cmplwi', 'b', 'ba', 'bl', 'bla', 'bc', 'bcl', 'bclr', 'bclrl', 'bcctr', 'bcctrl', 'blr', 'bctr', 'bctrl', ...Object.keys(conditional), 'mflr', 'mtlr', 'mfctr', 'mtctr', 'mfxer', 'mtxer', 'mfcr', 'mtcr', 'rlwinm', 'slwi', 'srwi', 'srawi', 'extsb', 'extsh', 'cntlzw', 'sc', 'sync', 'isync', ...floatInstructions]
const sx16 = (n: number) => n << 16 >> 16
function reg(text: string): number {
	const match = /^(?:r)?(\d+)$/i.exec(text.trim())
	if (!match || +match[1] > 31) throw new Error(`Expected a PowerPC register r0–r31, got ${text}`)
	return +match[1]
}
function integer(n: number, min: number, max: number, what: string): number {
	if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${what} must be ${min} through ${max}`)
	return n
}
const bytes = (word: number) => [word >>> 24, word >>> 16 & 255, word >>> 8 & 255, word & 255]
const d = (op: number, t: number, a: number, imm: number) => op << 26 | t << 21 | a << 16 | imm & 65535
const x = (t: number, a: number, b: number, xo: number, record = false) => 31 << 26 | t << 21 | a << 16 | b << 11 | xo << 1 | +record
function address(text: string, c: CpuEncodingContext): [number, number] {
	const m = /^(.*?)\(([^()]+)\)$/.exec(text)
	if (!m) throw new Error('Expected displacement(rA)')
	return [integer(c.value(m[1] || '0'), -32768, 32767, 'Displacement'), reg(m[2])]
}
export function encode(mnemonic: string, operands: readonly string[], c: CpuEncodingContext): number[] {
	let m = mnemonic.toLowerCase(), o = [...operands]
	const counts: Record<string, number> = { sc: 0, sync: 0, isync: 0, nop: 0, blr: 0, bctr: 0, bctrl: 0, b: 1, ba: 1, bl: 1, bla: 1, li: 2, lis: 2, la: 2, mr: 2, neg: 2, not: 2, mflr: 1, mtlr: 1, mfctr: 1, mtctr: 1, mfxer: 1, mtxer: 1, mfcr: 1, mtcr: 1, bclr: 2, bclrl: 2, bcctr: 2, bcctrl: 2, extsb: 2, extsh: 2, cntlzw: 2 }
	if (!instructions.includes(m)) throw new Error(`Unsupported PowerPC instruction ${mnemonic}`)
	const float = encodeFloat(m, o, c)
	if (float !== null) return bytes(float)
	const expected = counts[m] ?? (m in conditional ? 1 : m in memory ? 2 : 3)
	if (o.length !== expected && !(['cmpw', 'cmplw', 'cmpwi', 'cmplwi'].includes(m) && o.length === 2) && !(m === 'rlwinm' && o.length === 5)) throw new Error(`${m} expects ${m === 'rlwinm' ? 5 : expected} operands`)
	const v = (i: number) => c.value(o[i]), r = (i: number) => reg(o[i])
	if (m === 'li' || m === 'lis') { o = [o[0], 'r0', o[1]]; m = m === 'li' ? 'addi' : 'addis' }
	if (m === 'la') { const [disp, base] = address(o[1], c); return bytes(d(14, r(0), base, disp)) }
	if (m === 'subi') { o[2] = String(-v(2)); m = 'addi' }
	if (m === 'mr' || m === 'not') { o = [o[0], o[1], o[1]]; m = m === 'mr' ? 'or' : 'nor' }
	if (m === 'nop') return bytes(0x60000000)
	if (m === 'sc') return bytes(0x44000002)
	if (m === 'sync') return bytes(0x7c0004ac)
	if (m === 'isync') return bytes(0x4c00012c)
	if (m === 'addi' || m === 'addis' || m === 'mulli') return bytes(d(m === 'addi' ? 14 : m === 'addis' ? 15 : 7, r(0), r(1), integer(v(2), -32768, 32767, 'Immediate')))
	if (['ori', 'oris', 'xori', 'xoris', 'andi.', 'andis.'].includes(m)) return bytes(d(({ ori: 24, oris: 25, xori: 26, xoris: 27, 'andi.': 28, 'andis.': 29 })[m]!, r(1), r(0), integer(v(2), 0, 65535, 'Immediate')))
	if (m in memory) {
		const [disp, a] = address(o[1], c), t = r(0)
		if ((memory[m] & 1) && (!a || (memory[m] < 36 || memory[m] >= 40 && memory[m] < 44) && a === t)) throw new Error('Invalid update address register')
		return bytes(d(memory[m], t, a, disp))
	}
	if (m in indexed) return bytes(x(r(0), r(1), r(2), indexed[m]))
	if (/^b(?:l)?a?$/.test(m)) {
		const absolute = m.endsWith('a'), delta = v(0) - (absolute ? 0 : c.address)
		integer(delta, -33554432, 33554428, 'Branch displacement')
		if (delta & 3) throw new Error('Branch target must be word aligned')
		return bytes(18 << 26 | delta & 0x3fffffc | +absolute << 1 | +(m.includes('l')))
	}
	if (m in conditional || m === 'bc' || m === 'bcl') {
		const alias = conditional[m], bo = alias?.[0] ?? integer(v(0), 0, 31, 'BO'), bi = alias?.[1] ?? integer(v(1), 0, 31, 'BI')
		const delta = c.value(o[alias ? 0 : 2]) - c.address
		integer(delta, -32768, 32764, 'Branch displacement')
		if (delta & 3) throw new Error('Branch target must be word aligned')
		return bytes(16 << 26 | bo << 21 | bi << 16 | delta & 65532 | +(m === 'bcl'))
	}
	if (['blr', 'bctr', 'bctrl', 'bclr', 'bclrl', 'bcctr', 'bcctrl'].includes(m)) {
		const ctr = m.includes('ctr'), alias = ['blr', 'bctr', 'bctrl'].includes(m), bo = alias ? 20 : integer(v(0), 0, 31, 'BO'), bi = alias ? 0 : integer(v(1), 0, 31, 'BI')
		if (ctr && !(bo & 4)) throw new Error('bcctr cannot decrement CTR')
		return bytes(19 << 26 | bo << 21 | bi << 16 | (ctr ? 528 : 16) << 1 | +(m === 'bctrl' || m === 'bclrl' || m === 'bcctrl'))
	}
	if (['cmpw', 'cmplw', 'cmpwi', 'cmplwi'].includes(m)) {
		const field = o.length === 3 ? integer(Number(o.shift()!.replace(/^cr/i, '')), 0, 7, 'CR field') : 0
		const unsigned = m.startsWith('cmpl'), imm = m.endsWith('i')
		return bytes(imm ? d(unsigned ? 10 : 11, field << 2, r(0), integer(v(1), unsigned ? 0 : -32768, unsigned ? 65535 : 32767, 'Compare immediate')) : x(field << 2, r(0), r(1), unsigned ? 32 : 0))
	}
	if (/^m[ft](lr|ctr|xer)$/.test(m)) {
		const spr = m.endsWith('lr') ? 8 : m.endsWith('ctr') ? 9 : 1
		return bytes(x(r(0), spr & 31, spr >>> 5, m[1] === 'f' ? 339 : 467))
	}
	if (m === 'mfcr') return bytes(x(r(0), 0, 0, 19))
	if (m === 'mtcr') return bytes(31 << 26 | r(0) << 21 | 255 << 12 | 144 << 1)
	if (m === 'neg') return bytes(x(r(0), r(1), 0, 104))
	if (['extsb', 'extsh', 'cntlzw'].includes(m)) return bytes(x(r(1), r(0), 0, ({ extsb: 954, extsh: 922, cntlzw: 26 })[m]!))
	if (m === 'rlwinm' || m === 'slwi' || m === 'srwi') {
		const n = integer(v(2), 0, 31, 'Shift'), sh = m === 'srwi' ? (32 - n) & 31 : n, mb = m === 'srwi' ? n : m === 'rlwinm' ? integer(v(3), 0, 31, 'Mask begin') : 0, me = m === 'slwi' ? 31 - n : m === 'rlwinm' ? integer(v(4), 0, 31, 'Mask end') : 31
		return bytes(21 << 26 | r(1) << 21 | r(0) << 16 | sh << 11 | mb << 6 | me << 1)
	}
	if (m === 'srawi') return bytes(x(r(1), r(0), integer(v(2), 0, 31, 'Shift'), 824))
	const record = m.endsWith('.'), base = record ? m.slice(0, -1) : m
	if (base in arithmetic) return bytes(x(r(0), r(1), r(2), arithmetic[base], record))
	if (base in logical) return bytes(x(r(1), r(0), r(2), logical[base], record))
	throw new Error(`Unsupported PowerPC form ${mnemonic}`)
}

function cr(cpu: CpuContext, value: number, field = 0): void {
	const nibble = ((value | 0) < 0 ? 8 : (value | 0) > 0 ? 4 : 2) | cpu.r[XER] >>> 31
	const shift = (7 - field) * 4
	cpu.r[CR] = cpu.r[CR] & ~(15 << shift) | nibble << shift
}
function branchCondition(cpu: CpuContext, bo: number, bi: number): boolean {
	if (!(bo & 4)) cpu.r[CTR]--
	const ctrOK = !!(bo & 4) || (cpu.r[CTR] !== 0) !== !!(bo & 2)
	const condition = !!(bo & 16) || !!(cpu.r[CR] & 1 << (31 - bi)) === !!(bo & 8)
	return ctrOK && condition
}
function consoleCall(cpu: CpuContext): void {
	switch (cpu.r[0]) {
		case 1: cpu.output(String(cpu.r[3] | 0)); break
		case 4: { let text = '', a = cpu.r[3]; while (a < cpu.memory.length && cpu.memory[a]) text += String.fromCharCode(cpu.read(a++, 1)); cpu.output(text); break }
		case 5: cpu.r[3] = cpu.inputInteger(32); break
		case 10: cpu.halt(); break
		case 11: cpu.output(String.fromCharCode(cpu.r[3] & 255)); break
		default: throw new Error(`Unsupported educational SC service ${cpu.r[0]}`)
	}
}
export function decode(memoryBytes: Uint8Array, address: number): CpuInstruction {
	if (address & 3 || address + 4 > memoryBytes.length) throw new Error('Unaligned or out-of-range PowerPC instruction')
	const word = (memoryBytes[address] << 24 | memoryBytes[address + 1] << 16 | memoryBytes[address + 2] << 8 | memoryBytes[address + 3]) >>> 0
	const op = word >>> 26, t = word >>> 21 & 31, a = word >>> 16 & 31, b = word >>> 11 & 31, imm = sx16(word), xo = word >>> 1 & 1023, record = !!(word & 1)
	const float = decodeFloat(word)
	if (float) return float
	const rn = (n: number) => `r${n}`
	const reads: string[] = [], writes: string[] = []
	const rd = (...indices: number[]) => reads.push(...indices.map(i => i < 32 ? rn(i) : ['cr', 'lr', 'ctr', 'xer'][i - 32]))
	const wr = (...indices: number[]) => writes.push(...indices.map(i => i < 32 ? rn(i) : ['cr', 'lr', 'ctr', 'xer'][i - 32]))
	if (op === 14 || op === 15 || op === 7) { if (a || op === 7) rd(a); wr(t) }
	else if (op >= 24 && op <= 29) { rd(t); wr(a); if (op >= 28) { rd(XER); wr(CR) } }
	else if (op >= 32 && op <= 45) { const store = [36, 37, 38, 39, 44, 45].includes(op); if (a) rd(a); if (store) rd(t); else wr(t); if (op & 1) wr(a) }
	else if (op === 18 || op === 16 || op === 19 && (xo === 16 || xo === 528)) {
		if (op !== 18) { if (!(t & 4)) { rd(CTR); wr(CTR) } if (!(t & 16)) rd(CR); if (op === 19) rd(xo === 16 ? LR : CTR) }
		if (record) wr(LR)
	} else if (op === 10 || op === 11 || op === 31 && (xo === 0 || xo === 32)) { rd(a, XER); if (op === 31) rd(b); wr(CR) }
	else if (op === 21) { rd(t); wr(a); if (record) { rd(XER); wr(CR) } }
	else if (op === 17) { rd(0, 3); wr(3) }
	else if (op === 31) {
		if (Object.values(arithmetic).includes(xo)) { rd(a, b); wr(t) }
		else if (Object.values(logical).includes(xo)) { rd(t, b); wr(a); if (xo === 792) { rd(XER); wr(XER) } }
		else if (Object.values(indexed).includes(xo)) { if (a) rd(a); rd(b); if ([151, 215, 407].includes(xo)) rd(t); else wr(t) }
		else if (xo === 339 || xo === 467) { const spr = a | b << 5, index = spr === 8 ? LR : spr === 9 ? CTR : XER; if (xo === 339) { rd(index); wr(t) } else { rd(t); wr(index) } }
		else if (xo === 19) { rd(CR); wr(t) }
		else if (xo === 144) { rd(t, CR); wr(CR) }
		else if (xo === 104) { rd(a); wr(t) }
		else if ([954, 922, 26, 824].includes(xo)) { rd(t); wr(a); if (xo === 824) { rd(XER); wr(XER) } }
		if (record && xo !== 339 && xo !== 467) { rd(XER); wr(CR) }
	}
	const make = (text: string, execute: (cpu: CpuContext) => void, extra?: Partial<CpuInstruction>): CpuInstruction => ({ size: 4, text, execute, kind: 'alu', reads, writes, ...extra })
	if (op === 14 || op === 15 || op === 7) return make(`${op === 14 ? 'addi' : op === 15 ? 'addis' : 'mulli'} ${rn(t)}, ${rn(a)}, ${imm}`, c => { c.r[t] = op === 7 ? Math.imul(c.r[a], imm) : (a ? c.r[a] : 0) + imm * (op === 15 ? 65536 : 1) })
	if (op >= 24 && op <= 29) return make(`${['ori', 'oris', 'xori', 'xoris', 'andi.', 'andis.'][op - 24]} ${rn(a)}, ${rn(t)}, ${word & 65535}`, c => { const v = (word & 65535) * (op & 1 ? 65536 : 1); c.r[a] = op < 26 ? c.r[t] | v : op < 28 ? c.r[t] ^ v : c.r[t] & v; if (op >= 28) cr(c, c.r[a]) })
	if (op >= 32 && op <= 45) {
		const name = Object.keys(memory).find(n => memory[n] === op)!, store = [36, 37, 38, 39, 44, 45].includes(op), width = op < 34 || op === 36 || op === 37 ? 4 : op < 40 ? 1 : 2
		if ((op & 1) && (!a || !store && a === t)) throw new Error('Invalid PowerPC update address register')
		return make(`${name} ${rn(t)}, ${imm}(${rn(a)})`, c => { const ea = ((a ? c.r[a] : 0) + imm) >>> 0; if (width > 1 && ea % width) throw new Error('Unaligned PowerPC data access'); if (store) c.write(ea, c.r[t], width, false); else { const v = c.read(ea, width, false); c.r[t] = op === 42 || op === 43 ? sx16(v) : v } if (op & 1) c.r[a] = ea }, { kind: store ? 'store' : 'load' })
	}
	if (op === 18 || op === 16) {
		const delta = op === 18 ? word << 6 >> 6 & ~3 : sx16(word) & ~3, target = ((word & 2 ? 0 : address) + delta) >>> 0, link = !!(word & 1)
		return make(`${op === 18 ? 'b' : 'bc'}${link ? 'l' : ''} ${op === 16 ? `${t}, ${a}, ` : ''}0x${target.toString(16)}`, c => { const take = op === 18 || branchCondition(c, t, a), returnAddress = c.pc; if (link) c.r[LR] = returnAddress; c.branch(target, take); if (take && link) c.call(target, returnAddress) }, { call: link, kind: link ? 'call' : 'branch' })
	}
	if (op === 19 && (xo === 16 || xo === 528)) {
		if (xo === 528 && !(t & 4)) throw new Error('Invalid PowerPC bcctr BO field')
		return make(`${xo === 16 ? 'bclr' : 'bcctr'}${record ? 'l' : ''} ${t}, ${a}`, c => { const target = c.r[xo === 16 ? LR : CTR] & ~3, take = branchCondition(c, t, a), returnAddress = c.pc; if (record) c.r[LR] = returnAddress; c.branch(target, take); if (take && record) c.call(target, returnAddress); else if (take && xo === 16) c.ret(target) }, { call: record, kind: record ? 'call' : xo === 16 ? 'return' : 'jump' })
	}
	if (word === 0x44000002) return make('sc', consoleCall, { kind: 'system' })
	if (word === 0x7c0004ac || word === 0x4c00012c) return make(word === 0x7c0004ac ? 'sync' : 'isync', () => {})
	if (op === 10 || op === 11 || op === 31 && (xo === 0 || xo === 32)) {
		const unsigned = op === 10 || xo === 32, immediate = op !== 31
		if (word & (1 << 21)) throw new Error('64-bit PowerPC compare is not supported')
		return make(`${unsigned ? 'cmplw' : 'cmpw'}${immediate ? 'i' : ''} cr${t >>> 2}, ${rn(a)}, ${immediate ? unsigned ? word & 65535 : imm : rn(b)}`, c => { const lhs = unsigned ? c.r[a] : c.r[a] | 0, rhs = immediate ? unsigned ? word & 65535 : imm : unsigned ? c.r[b] : c.r[b] | 0; cr(c, lhs < rhs ? -1 : lhs > rhs ? 1 : 0, t >>> 2) })
	}
	if (op === 21) return make(`rlwinm ${rn(a)}, ${rn(t)}, ${b}, ${word >>> 6 & 31}, ${word >>> 1 & 31}`, c => { const mb = word >>> 6 & 31, me = word >>> 1 & 31; let mask = 0; for (let bit = 0; bit < 32; bit++) if (mb <= me ? bit >= mb && bit <= me : bit >= mb || bit <= me) mask |= 1 << 31 - bit; c.r[a] = (c.r[t] << b | c.r[t] >>> (32 - b & 31)) & mask; if (record) cr(c, c.r[a]) })
	if (op === 31) {
		const arith = Object.keys(arithmetic).find(n => arithmetic[n] === xo), logic = Object.keys(logical).find(n => logical[n] === xo), mem = Object.keys(indexed).find(n => indexed[n] === xo)
		if (arith) return make(`${arith}${record ? '.' : ''} ${rn(t)}, ${rn(a)}, ${rn(b)}`, c => { const av = c.r[a], bv = c.r[b]; if (arith.startsWith('div') && (!bv || arith === 'divw' && av === 0x80000000 && bv === 0xffffffff)) throw new Error('PowerPC divide overflow or division by zero'); c.r[t] = arith === 'add' ? av + bv : arith === 'subf' ? bv - av : arith === 'mullw' ? Math.imul(av, bv) : arith === 'divw' ? Math.trunc((av | 0) / (bv | 0)) : Math.trunc(av / bv); if (record) cr(c, c.r[t]) })
		if (logic) return make(`${logic}${record ? '.' : ''} ${rn(a)}, ${rn(t)}, ${rn(b)}`, c => { const s = c.r[t], v = c.r[b], n = v & 63; c.r[a] = logic === 'and' ? s & v : logic === 'andc' ? s & ~v : logic === 'or' ? s | v : logic === 'orc' ? s | ~v : logic === 'xor' ? s ^ v : logic === 'nor' ? ~(s | v) : logic === 'nand' ? ~(s & v) : logic === 'eqv' ? ~(s ^ v) : logic === 'slw' ? n < 32 ? s << n : 0 : logic === 'srw' ? n < 32 ? s >>> n : 0 : (s | 0) >> Math.min(n, 31); if (logic === 'sraw') { const carry = (s | 0) < 0 && n > 0 && (n >= 32 || !!(s & (2 ** n - 1))); c.r[XER] = c.r[XER] & ~0x20000000 | +carry << 29 } if (record) cr(c, c.r[a]) })
		if (mem) return make(`${mem} ${rn(t)}, ${rn(a)}, ${rn(b)}`, c => { const ea = ((a ? c.r[a] : 0) + c.r[b]) >>> 0, store = mem.startsWith('st'), width = mem.includes('w') ? 4 : mem.includes('h') ? 2 : 1; if (width > 1 && ea % width) throw new Error('Unaligned PowerPC data access'); if (store) c.write(ea, c.r[t], width, false); else { const v = c.read(ea, width, false); c.r[t] = mem === 'lhax' ? sx16(v) : v } }, { kind: mem.startsWith('st') ? 'store' : 'load' })
		if (xo === 339 || xo === 467) { const spr = a | b << 5, index = spr === 8 ? LR : spr === 9 ? CTR : spr === 1 ? XER : -1; if (index < 0) throw new Error(`Unsupported PowerPC SPR ${spr}`); return make(`${xo === 339 ? 'mf' : 'mt'}${spr === 8 ? 'lr' : spr === 9 ? 'ctr' : 'xer'} ${rn(t)}`, c => { if (xo === 339) c.r[t] = c.r[index]; else c.r[index] = c.r[t] }) }
		if (xo === 19) return make(`mfcr ${rn(t)}`, c => { c.r[t] = c.r[CR] })
		if (xo === 144) return make(`mtcrf ${word >>> 12 & 255}, ${rn(t)}`, c => { const fields = word >>> 12 & 255; for (let f = 0; f < 8; f++) if (fields & 1 << f) { const mask = 15 << f * 4; c.r[CR] = c.r[CR] & ~mask | c.r[t] & mask } })
		if ([104, 954, 922, 26, 824].includes(xo)) return make(`${({ 104: 'neg', 954: 'extsb', 922: 'extsh', 26: 'cntlzw', 824: 'srawi' })[xo]} ${rn(xo === 104 ? t : a)}, ${rn(xo === 104 ? a : t)}${xo === 824 ? `, ${b}` : ''}`, c => { const dest = xo === 104 ? t : a, source = c.r[xo === 104 ? a : t]; c.r[dest] = xo === 104 ? -source : xo === 954 ? source << 24 >> 24 : xo === 922 ? source << 16 >> 16 : xo === 26 ? Math.clz32(source) : (source | 0) >> b; if (xo === 824) c.r[XER] = c.r[XER] & ~0x20000000 | +((source | 0) < 0 && !!(source & (2 ** b - 1))) << 29; if (record) cr(c, c.r[dest]) })
	}
	throw new Error(`Unsupported PowerPC instruction 0x${word.toString(16).padStart(8, '0')}`)
}
