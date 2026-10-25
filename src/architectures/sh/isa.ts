import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'

export const SR = 16, GBR = 17, VBR = 18, MACH = 19, MACL = 20, PR = 21
export const reference = 'https://www.renesas.com/en/document/mas/sh-1sh-2sh-dsp-software-manual'
export type Model = 'sh1' | 'sh2'
const T = 1, S = 2, Q = 256, M = 512, SR_MASK = 0x3f3
const pending = 0, active = 1, returning = 2, finishing = 3
export function advance(c: CpuContext) {
	c.writeState(active, c.state[pending]); c.writeState(pending, 0)
	c.writeState(finishing, c.state[returning]); c.writeState(returning, 0)
	c.pc = c.pc + 2 >>> 0
}
export function afterInstruction(c: CpuContext) {
	if (c.state[active]) c.pc = c.state[active] - 1
	if (c.state[finishing]) c.ret(c.pc)
	c.writeState(active, 0); c.writeState(finishing, 0)
}
function inSlot(c: CpuContext) { if (c.state[active]) throw new Error('SH slot-illegal instruction in a delay slot') }
function target(c: CpuContext, address: number) { if (address & 1) throw new Error('Unaligned SH instruction target'); c.writeState(pending, (address >>> 0) + 1) }
function bit(c: CpuContext, flag: number, on: boolean) { c.r[SR] = c.r[SR] & ~flag | (on ? flag : 0) }
const pcBase = (c: CpuContext, address: number) => c.state[active] ? c.state[active] + 1 >>> 0 : address + 4 >>> 0
const signed = (n: number, bits: number) => bits === 8 ? n << 24 >> 24 : bits === 16 ? n << 16 >> 16 : n | 0
function aligned(at: number, bytes: number) { if (at % bytes) throw new Error(`Unaligned SH ${bytes}-byte access`); return at >>> 0 }
const read = (c: CpuContext, at: number, bytes: number) => c.read(aligned(at, bytes), bytes)
const write = (c: CpuContext, at: number, value: number, bytes: number) => c.write(aligned(at, bytes), value, bytes)
function reg(text: string) { const m = /^r(\d+)$/i.exec(text.trim()); if (!m || Number(m[1]) > 15) throw new Error(`Expected SH register R0..R15, got ${text}`); return Number(m[1]) }
function fit(n: number, min: number, max: number, message = 'Immediate/displacement') { if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${message} must be ${min} through ${max}`); return n }
const rr: Record<string, number> = { mov: 0x6003, add: 0x300c, addc: 0x300e, addv: 0x300f, sub: 0x3008, subc: 0x300a, subv: 0x300b, 'cmp/eq': 0x3000, 'cmp/hs': 0x3002, 'cmp/ge': 0x3003, 'cmp/hi': 0x3006, 'cmp/gt': 0x3007, 'cmp/str': 0x200c, tst: 0x2008, and: 0x2009, xor: 0x200a, or: 0x200b, not: 0x6007, neg: 0x600b, negc: 0x600a, 'extu.b': 0x600c, 'extu.w': 0x600d, 'exts.b': 0x600e, 'exts.w': 0x600f, 'swap.b': 0x6008, 'swap.w': 0x6009, xtrct: 0x200d, 'mulu.w': 0x200e, 'muls.w': 0x200f, 'mul.l': 0x0007, 'dmulu.l': 0x3005, 'dmuls.l': 0x300d, div0s: 0x2007, div1: 0x3004 }
const one: Record<string, number> = { 'cmp/pz': 0x4011, 'cmp/pl': 0x4015, 'dt': 0x4010, movt: 0x0029, shal: 0x4020, shar: 0x4021, shll: 0x4000, shlr: 0x4001, shll2: 0x4008, shlr2: 0x4009, shll8: 0x4018, shlr8: 0x4019, shll16: 0x4028, shlr16: 0x4029, rotl: 0x4004, rotr: 0x4005, rotcl: 0x4024, rotcr: 0x4025, jmp: 0x402b, jsr: 0x400b, braf: 0x0023, bsrf: 0x0003, 'tas.b': 0x401b }
const inherent: Record<string, number> = { nop: 0x0009, clrt: 0x0008, sett: 0x0018, clrmac: 0x0028, div0u: 0x0019, rts: 0x000b, rte: 0x002b, sleep: 0x001b }
const sh2Only = new Set(['braf', 'bsrf', 'bt/s', 'bf/s', 'dt', 'mul.l', 'dmulu.l', 'dmuls.l', 'mac.l'])
export const instructionsFor = (model: Model) => [...Object.keys(rr), ...Object.keys(one), ...Object.keys(inherent), 'mov.b', 'mov.w', 'mov.l', 'mova', 'mov32', 'bra', 'bsr', 'bt', 'bf', 'bt/s', 'bf/s', 'trapa', 'stc', 'sts', 'ldc', 'lds', 'stc.l', 'sts.l', 'ldc.l', 'lds.l', 'and.b', 'or.b', 'xor.b', 'tst.b', 'mac.w', 'mac.l'].filter(n => model === 'sh2' || !sh2Only.has(n))
export const instructionSize = (name: string) => name.toLowerCase() === 'mov32' ? 14 : 2
const bytes = (w: number) => [w >>> 8 & 255, w & 255]
const special: Record<string, number> = { sr: SR, gbr: GBR, vbr: VBR, mach: MACH, macl: MACL, pr: PR }
function memory(text: string) {
	const t = text.toLowerCase().replace(/\s/g, ''), indirect = /^@(-)?(r\d+)(\+)?$/.exec(t), displaced = /^@\((.*),(r\d+|gbr|pc)\)$/.exec(t)
	if (indirect) return { register: reg(indirect[2]), pre: !!indirect[1], post: !!indirect[3], displacement: null, base: '' }
	if (displaced) return { register: /^r/.test(displaced[2]) ? reg(displaced[2]) : 0, pre: false, post: false, displacement: text.trim().slice(2, text.lastIndexOf(',')).trim(), base: displaced[2] }
	return null
}
export function encode(mnemonic: string, args: readonly string[], c: CpuEncodingContext, model: Model = 'sh2'): number[] {
	const n = mnemonic.toLowerCase(), o = args.map(s => s.trim()), isRegister = (s: string) => /^r\d+$/i.test(s), imm = (s: string) => c.value(s.replace(/^#/, ''))
	if (!instructionsFor(model).includes(n)) throw new Error(`Unsupported ${model.toUpperCase()} instruction ${n}`)
	const count = (expected: number) => { if (o.length !== expected) throw new Error(`${n} expects ${expected} operands`) }
	if (n === 'mov32') {
		count(2); const value = fit(imm(o[0]), -2147483648, 4294967295, '32-bit constant'), rd = reg(o[1])
		const digits: number[] = []
		let remaining = value
		for (let i = 0; i < 3; i++) { const digit = remaining << 24 >> 24; digits.unshift(digit); remaining = (remaining - digit) / 256 }
		return [...bytes(0xe000 | rd << 8 | remaining & 255), ...digits.flatMap(digit => [...bytes(0x4018 | rd << 8), ...bytes(0x7000 | rd << 8 | digit & 255)])]
	}
	if (n in inherent) { count(0); return bytes(inherent[n]) }
	if (['bra', 'bsr', 'bt', 'bf', 'bt/s', 'bf/s'].includes(n)) {
		count(1); const wide = n === 'bra' || n === 'bsr', delta = c.value(o[0]) - c.address - 4
		if (delta & 1) throw new Error('Branch target must be halfword aligned')
		const displacement = fit(delta / 2, wide ? -2048 : -128, wide ? 2047 : 127)
		return bytes(({ bra: 0xa000, bsr: 0xb000, bt: 0x8900, bf: 0x8b00, 'bt/s': 0x8d00, 'bf/s': 0x8f00 })[n]! | displacement & (wide ? 4095 : 255))
	}
	if (n === 'trapa') { count(1); return bytes(0xc300 | fit(imm(o[0]), 0, 255)) }
	if (n in one) { count(1); return bytes(one[n] | reg(o[0].replace(/^@/, '')) << 8) }
	if (n === 'mova') {
		count(2); if (reg(o[1]) !== 0) throw new Error('MOVA destination must be R0')
		const mem = memory(o[0]), at = mem?.base === 'pc' ? (c.address + 4 & ~3) + imm(mem.displacement!) : imm(o[0])
		return bytes(0xc700 | fit((at - (c.address + 4 & ~3)) / 4, 0, 255))
	}
	if (/^(?:st[cs]|ld[cs])(?:\.l)?$/.test(n)) {
		count(2); const store = n.startsWith('st'), control = n.includes('c'), long = n.endsWith('.l'), sp = (store ? o[0] : o[1]).toLowerCase(), id = special[sp]
		if (id === undefined || control !== (id <= VBR)) throw new Error('Wrong SH special register class')
		const mem = memory(store ? o[1] : o[0]), r = long ? mem?.register : reg(store ? o[1] : o[0]), field = control ? id - SR : id - MACH
		if (r === undefined || long && (!mem || (store ? !mem.pre : !mem.post) || mem.displacement !== null)) throw new Error('Special word transfer needs @-Rn or @Rm+')
		return bytes((long || !store ? 0x4000 : 0) | r << 8 | field << 4 | (store ? long ? control ? 3 : 2 : control ? 2 : 10 : long ? control ? 7 : 6 : control ? 14 : 10))
	}
	if (n === 'mac.w' || n === 'mac.l') { count(2); const a = memory(o[0]), b = memory(o[1]); if (!a?.post || !b?.post) throw new Error('MAC requires two post-increment operands'); return bytes((n === 'mac.l' ? 0x000f : 0x400f) | b.register << 8 | a.register << 4) }
	if (n.startsWith('mov.')) {
		count(2); const size = ({ 'mov.b': 1, 'mov.w': 2, 'mov.l': 4 })[n]!, scale = size === 4 ? 2 : size === 2 ? 1 : 0, src = memory(o[0]), dst = memory(o[1])
		if (src && !dst || dst && !src) {
			const load = !!src, mem = src ?? dst!, r = reg(load ? o[1] : o[0]), base = mem.register
			if (mem.displacement === null) {
				if (load && mem.pre || !load && mem.post) throw new Error('Wrong SH pre/post addressing direction')
				return bytes((load ? 0x6000 : 0x2000) | (load ? r : base) << 8 | (load ? base : r) << 4 | scale | (mem.post || mem.pre ? 4 : 0))
			}
			if (/^r0$/i.test(mem.displacement)) {
				if (mem.base === 'gbr') throw new Error('MOV has no R0+GBR form')
				return bytes((load ? 0x000c : 0x0004) | (load ? r : base) << 8 | (load ? base : r) << 4 | scale)
			}
			if (mem.base === 'pc') {
				if (!load || size === 1) throw new Error('Only MOV.W/L loads have PC-relative addressing')
				return bytes((size === 4 ? 0xd000 : 0x9000) | r << 8 | fit(imm(mem.displacement) / size, 0, 255))
			}
			const disp = fit(imm(mem.displacement) / size, 0, mem.base === 'gbr' ? 255 : 15)
			if (mem.base === 'gbr') { if (r) throw new Error('GBR displacement transfer requires R0'); return bytes((load ? 0xc400 : 0xc000) | scale << 8 | disp) }
			if (size === 4) return bytes((load ? 0x5000 : 0x1000) | (load ? r : base) << 8 | (load ? base : r) << 4 | disp)
			if (r) throw new Error('Byte/word displacement transfer requires R0')
			return bytes((load ? 0x8400 : 0x8000) | scale << 8 | base << 4 | disp)
		}
		// Bare labels are literal-pool addresses for the native PC-relative load.
		if (!src && !dst && !isRegister(o[0]) && !o[0].startsWith('#') && size !== 1) { const at = imm(o[0]), base = size === 4 ? c.address + 4 & ~3 : c.address + 4; return bytes((size === 4 ? 0xd000 : 0x9000) | reg(o[1]) << 8 | fit((at - base) / size, 0, 255)) }
		throw new Error('Unsupported SH memory transfer form')
	}
	if (['and.b', 'or.b', 'xor.b', 'tst.b'].includes(n)) { count(2); if (!/^@\(r0,gbr\)$/i.test(o[1].replace(/\s/g, ''))) throw new Error('Byte logical instruction requires @(R0,GBR)'); return bytes(({ 'tst.b': 0xcc00, 'and.b': 0xcd00, 'xor.b': 0xce00, 'or.b': 0xcf00 })[n]! | fit(imm(o[0]), 0, 255)) }
	count(2)
	if (o[0].startsWith('#')) {
		const r = reg(o[1]), value = imm(o[0])
		if (n === 'mov' || n === 'add') return bytes((n === 'mov' ? 0xe000 : 0x7000) | r << 8 | fit(value, -128, 127) & 255)
		if (r || !['cmp/eq', 'tst', 'and', 'xor', 'or'].includes(n)) throw new Error('Immediate form requires R0')
		return bytes(({ 'cmp/eq': 0x8800, tst: 0xc800, and: 0xc900, xor: 0xca00, or: 0xcb00 })[n]! | fit(value, n === 'cmp/eq' ? -128 : 0, n === 'cmp/eq' ? 127 : 255) & 255)
	}
	if (!(n in rr)) throw new Error('Unsupported SH operand form')
	return bytes(rr[n] | reg(o[1]) << 8 | reg(o[0]) << 4)
}

function monitor(c: CpuContext, trap: number) {
	if (trap !== 0x10) throw new Error(`Unsupported SH software trap ${trap}`)
	switch (c.r[0]) {
		case 1: c.output(String(c.r[4] | 0)); break
		case 4: { let at = c.r[4], text = ''; for (;;) { const value = c.read(at++); if (!value) break; text += String.fromCharCode(value) } c.output(text); break }
		case 5: c.r[4] = c.inputInteger(32); break
		case 10: c.halt(); break
		case 11: c.output(String.fromCharCode(c.r[4] & 255)); break
		default: throw new Error(`Unsupported THRAX SH monitor service ${c.r[0]}`)
	}
}
export function decode(memory: Uint8Array, address: number, model: Model = 'sh2'): CpuInstruction {
	if (address & 1 || address + 2 > memory.length) throw new Error('Unaligned/out-of-range SH instruction')
	const w = memory[address] << 8 | memory[address + 1], n = w >>> 8 & 15, m = w >>> 4 & 15, imm = w & 255, high = w >>> 12, low = w & 15
	const reads: string[] = [], writes: string[] = [], rn = (r: number) => `r${r}`, make = (text: string, execute: CpuInstruction['execute'], kind: CpuInstruction['kind'] = 'alu', call = false): CpuInstruction => {
		const name = text.split(/\s/)[0]
		if (model === 'sh1' && sh2Only.has(name)) throw new Error(`Instruction ${name} is unavailable on SH-1`)
		return { size: 2, text, execute, kind, call, reads, writes }
	}
	const inherentName = Object.keys(inherent).find(k => inherent[k] === w)
	if (inherentName) {
		if (inherentName === 'clrt' || inherentName === 'sett' || inherentName === 'div0u') writes.push('sr')
		if (inherentName === 'clrmac') writes.push('mach', 'macl')
		if (inherentName === 'rts') reads.push('pr')
		return make(inherentName, c => {
			switch (inherentName) {
				case 'nop': break
				case 'clrt': bit(c, T, false); break
				case 'sett': bit(c, T, true); break
				case 'div0u': c.r[SR] &= ~(M | Q | T); break
				case 'clrmac': c.r[MACH] = c.r[MACL] = 0; break
				case 'rts': inSlot(c); target(c, c.r[PR]); c.writeState(returning, 1); break
				case 'rte': inSlot(c); throw new Error('SH native exception return is not modeled')
				case 'sleep': throw new Error('SH SLEEP requires external interrupt delivery')
			}
		}, inherentName === 'rts' || inherentName === 'rte' ? 'return' : inherentName === 'sleep' ? 'system' : 'alu')
	}
	if (high === 0xa || high === 0xb || [0x89, 0x8b, 0x8d, 0x8f].includes(w >>> 8)) {
		const wide = high === 0xa || high === 0xb, call = high === 0xb, delay = wide || !!(w & 0x400), targetAddress = address + 4 + (wide ? w << 20 >> 19 : imm << 24 >> 23) >>> 0, name = wide ? call ? 'bsr' : 'bra' : `${w & 0x200 ? 'bf' : 'bt'}${delay ? '/s' : ''}`
		if (!wide) reads.push('sr'); if (call) writes.push('pr')
		return make(`${name} 0x${targetAddress.toString(16)}`, c => { inSlot(c); const taken = wide || !!(c.r[SR] & T) === !(w & 0x200); if (!wide) { const next = c.pc; c.branch(targetAddress, taken); c.pc = next } if (call) { const next = c.pc; c.r[PR] = address + 4; c.call(targetAddress, address + 4); c.pc = next } if (delay && taken) target(c, targetAddress); else if (taken) c.pc = targetAddress }, call ? 'call' : wide ? 'jump' : 'branch', call)
	}
	if (w >>> 8 === 0xc3) { reads.push('r0', 'r4'); writes.push('r4'); return make(`trapa #${imm}`, c => { inSlot(c); monitor(c, imm) }, 'system') }
	if (high === 0xe || high === 7) { if (high === 7) reads.push(rn(n)); writes.push(rn(n)); return make(`${high === 7 ? 'add' : 'mov'} #${signed(imm, 8)},r${n}`, c => { c.r[n] = high === 7 ? c.r[n] + signed(imm, 8) : signed(imm, 8) }) }
	if (w >>> 8 === 0x88 || w >>> 8 >= 0xc8 && w >>> 8 <= 0xcf) {
		const group = w >>> 8, name = group === 0x88 ? 'cmp/eq' : ['tst', 'and', 'xor', 'or'][group & 3], byte = group >= 0xcc
		reads.push('r0'); if (byte) reads.push('gbr'); if (name === 'tst' || name === 'cmp/eq') writes.push('sr'); else if (!byte) writes.push('r0')
		return make(`${name}${byte ? '.b' : ''} #${imm},${byte ? '@(r0,gbr)' : 'r0'}`, c => { const at = c.r[GBR] + c.r[0] >>> 0, old = byte ? read(c, at, 1) : c.r[0], result = name === 'and' || name === 'tst' ? old & imm : name === 'xor' ? old ^ imm : old | imm; if (name === 'cmp/eq') bit(c, T, old === (signed(imm, 8) >>> 0)); else if (name === 'tst') bit(c, T, result === 0); else if (byte) write(c, at, result, 1); else c.r[0] = result })
	}
	if (w >>> 8 === 0xc7) { writes.push('r0'); return make(`mova @(${imm * 4},pc),r0`, c => { c.r[0] = (pcBase(c, address) & ~3) + imm * 4 }) }
	if (high === 9 || high === 0xd) { const size = high === 9 ? 2 : 4; writes.push(rn(n)); return make(`mov.${size === 2 ? 'w' : 'l'} @(${imm * size},pc),r${n}`, c => { const base = pcBase(c, address); c.r[n] = signed(read(c, (size === 4 ? base & ~3 : base) + imm * size >>> 0, size), size * 8) }, 'load') }
	if (high === 1 || high === 5 || high === 2 && low <= 2 || high === 2 && low >= 4 && low <= 6 || high === 6 && low <= 2 || high === 6 && low >= 4 && low <= 6 || high === 0 && (low >= 4 && low <= 6 || low >= 12 && low <= 14) || w >>> 8 >= 0xc0 && w >>> 8 <= 0xc6 || [0x80, 0x81, 0x84, 0x85].includes(w >>> 8)) {
		const displacement = high === 1 || high === 5, gbr = high === 0xc, small = high === 8, indexed = high === 0
		const load = displacement ? high === 5 : gbr || small ? !!(w & 0x400) : high === 6 || high === 0 && low >= 12
		const size = displacement ? 4 : gbr || small ? 1 << (w >>> 8 & 3) : 1 << (low & 3), pre = high === 2 && low >= 4, post = high === 6 && low >= 4
		const r = gbr || small ? 0 : load ? n : m, base = small ? m : load ? m : n, disp = displacement || small ? (w & 15) * size : gbr ? imm * size : 0
		reads.push(gbr ? 'gbr' : rn(base)); if (indexed) reads.push('r0'); if (load) writes.push(rn(r)); else reads.push(rn(r)); if (pre || post) writes.push(rn(base))
		const addr = gbr ? `@(${disp},gbr)` : displacement || small ? `@(${disp},r${base})` : indexed ? `@(r0,r${base})` : `@${pre ? '-' : ''}r${base}${post ? '+' : ''}`
		return make(`mov.${size === 1 ? 'b' : size === 2 ? 'w' : 'l'} ${load ? `${addr},r${r}` : `r${r},${addr}`}`, c => {
			const old = c.r[r]
			if (pre) c.r[base] -= size
			const at = (gbr ? c.r[GBR] : c.r[base]) + disp + (indexed ? c.r[0] : 0) >>> 0
			if (load) { const value = signed(read(c, at, size), size * 8); if (post && base !== r) c.r[base] += size; c.r[r] = value }
			else write(c, at, old, size)
		}, load ? 'load' : 'store')
	}
	const oneName = Object.keys(one).find(k => (w & 0xf0ff) === one[k])
	if (oneName) {
		reads.push(rn(n)); if (['jmp', 'jsr', 'braf', 'bsrf'].includes(oneName)) { if (oneName === 'jsr' || oneName === 'bsrf') writes.push('pr') }
		else { writes.push(...(oneName.startsWith('cmp/') || oneName === 'tas.b' ? [] : [rn(n)])); if (!['shll2', 'shlr2', 'shll8', 'shlr8', 'shll16', 'shlr16', 'movt'].includes(oneName)) writes.push('sr'); if (oneName === 'movt' || oneName === 'rotcl' || oneName === 'rotcr') reads.push('sr') }
		const call = oneName === 'jsr' || oneName === 'bsrf', jump = call || oneName === 'jmp' || oneName === 'braf'
		return make(`${oneName} ${oneName === 'jmp' || oneName === 'jsr' || oneName === 'tas.b' ? '@' : ''}r${n}`, c => {
			const value = c.r[n], oldT = c.r[SR] & T
			if (jump) { inSlot(c); const to = oneName.endsWith('f') ? address + 4 + value >>> 0 : value; if (call) { const next = c.pc; c.r[PR] = address + 4; c.call(to, address + 4); c.pc = next } target(c, to); return }
			if (oneName === 'movt') { c.r[n] = oldT; return }
			if (oneName === 'cmp/pz' || oneName === 'cmp/pl') { bit(c, T, oneName === 'cmp/pz' ? (value | 0) >= 0 : (value | 0) > 0); return }
			if (oneName === 'dt') { c.r[n]--; bit(c, T, c.r[n] === 0); return }
			if (oneName === 'tas.b') { const old = read(c, value, 1); bit(c, T, old === 0); write(c, value, old | 128, 1); return }
			const count = oneName.endsWith('16') ? 16 : oneName.endsWith('8') ? 8 : oneName.endsWith('2') ? 2 : 1, right = oneName.includes('r') && !oneName.startsWith('rotcl') && oneName !== 'rotl', rotate = oneName.startsWith('rot')
			const shifted = right ? value & 1 : value >>> 31
			let result = right ? oneName === 'shar' ? (value | 0) >> count : value >>> count : value << count
			if (rotate) result |= right ? (oneName === 'rotcr' ? oldT : shifted) << 31 : oneName === 'rotcl' ? oldT : shifted
			c.r[n] = result; if (count === 1) bit(c, T, !!shifted)
		}, call ? 'call' : jump ? 'jump' : 'alu', call)
	}
	if ((w & 0xf00f) === 0x000f || (w & 0xf00f) === 0x400f) {
		const long = high === 0, size = long ? 4 : 2
		reads.push(rn(m), rn(n), 'sr', 'mach', 'macl'); writes.push(rn(m), rn(n), 'mach', 'macl')
		return make(`mac.${long ? 'l' : 'w'} @r${m}+,@r${n}+`, c => {
			const x = signed(read(c, c.r[m], size), size * 8); c.r[m] += size
			const y = signed(read(c, c.r[n], size), size * 8); c.r[n] += size
			const product = BigInt(x) * BigInt(y)
			let sum = product + BigInt.asIntN(64, BigInt(c.r[MACH]) << 32n | BigInt(c.r[MACL]))
			let saturatedLong = false
			if (c.r[SR] & S) {
				const bits = long ? 48n : 32n, min = -(1n << bits - 1n), max = (1n << bits - 1n) - 1n
				// MAC.L's native saturation operation adds only MACH's low 16 bits.
				sum = product + (long ? BigInt(c.r[MACH] & 0xffff) << 32n | BigInt(c.r[MACL]) : BigInt(c.r[MACL] | 0))
				if (sum < min || sum > max) {
					if (!long && model === 'sh1') c.r[MACH] |= 1
					saturatedLong = long
					sum = sum < min ? min : max
				}
			}
			c.r[MACL] = Number(BigInt.asUintN(32, sum)); if (!(c.r[SR] & S) || long) c.r[MACH] = model === 'sh1' ? Number(BigInt.asIntN(10, sum >> 32n)) >>> 0 : Number(BigInt.asUintN(32, sum >> 32n))
			if (saturatedLong) c.r[MACH] &= 0xffff
		})
	}
	if ((high === 0 && [2, 10].includes(low) || high === 4 && [2, 3, 6, 7, 10, 14].includes(low)) && [0, 1, 2].includes(m)) {
		const control = low === 2 && high === 0 || [3, 7, 14].includes(low), store = high === 0 || low === 2 || low === 3, long = high === 4 && [2, 3, 6, 7].includes(low), index = (control ? SR : MACH) + m, name = ['sr', 'gbr', 'vbr', 'mach', 'macl', 'pr'][index - SR]
		if (store) { reads.push(name); if (long) { reads.push(rn(n)); writes.push(rn(n)) } else writes.push(rn(n)) } else { reads.push(rn(n)); writes.push(name); if (long) writes.push(rn(n)) }
		return make(`${store ? 'st' : 'ld'}${control ? 'c' : 's'}${long ? '.l' : ''} ${store ? `${name},${long ? '@-' : ''}r${n}` : `${long ? '@' : ''}r${n}${long ? '+' : ''},${name}`}`, c => {
			if (index === SR && !store) inSlot(c)
			if (store) { if (long) { c.r[n] -= 4; write(c, c.r[n], c.r[index], 4) } else c.r[n] = c.r[index] }
			else { const value = long ? read(c, c.r[n], 4) : c.r[n]; if (long) c.r[n] += 4; c.r[index] = index === SR ? value & SR_MASK : index === MACH && model === 'sh1' ? value << 22 >> 22 : value }
		})
	}
	const name = Object.keys(rr).find(k => (w & 0xf00f) === rr[k])
	if (name) {
		reads.push(rn(m)); if (!['mov', 'not', 'neg', 'negc', 'extu.b', 'extu.w', 'exts.b', 'exts.w', 'swap.b', 'swap.w'].includes(name)) reads.push(rn(n))
		const compare = name.startsWith('cmp/') || name === 'tst', multiply = name.includes('mul'), wide = name.startsWith('dmul')
		if (compare || ['addc', 'addv', 'subc', 'subv', 'negc', 'div0s', 'div1'].includes(name)) writes.push('sr')
		if (['addc', 'subc', 'negc', 'div1'].includes(name)) reads.push('sr')
		if (multiply) writes.push('macl', ...(wide ? ['mach'] : [])); else if (!compare && name !== 'div0s') writes.push(rn(n))
		return make(`${name} r${m},r${n}`, c => {
			const x = c.r[n], y = c.r[m], carry = c.r[SR] & T
			let result = x
			switch (name) {
				case 'mov': result = y; break
				case 'add': result = x + y; break
				case 'addc': result = x + y + carry; bit(c, T, result > 0xffffffff); break
				case 'addv': result = x + y; bit(c, T, (x | 0) + (y | 0) < -2147483648 || (x | 0) + (y | 0) > 2147483647); break
				case 'sub': result = x - y; break
				case 'subc': result = x - y - carry; bit(c, T, result < 0); break
				case 'subv': result = x - y; bit(c, T, (x | 0) - (y | 0) < -2147483648 || (x | 0) - (y | 0) > 2147483647); break
				case 'neg': result = -y; break
				case 'negc': result = -y - carry; bit(c, T, result < 0); break
				case 'not': result = ~y; break
				case 'and': case 'tst': result = x & y; if (name === 'tst') bit(c, T, result === 0); break
				case 'xor': result = x ^ y; break
				case 'or': result = x | y; break
				case 'cmp/eq': bit(c, T, x === y); break
				case 'cmp/hs': bit(c, T, x >= y); break
				case 'cmp/hi': bit(c, T, x > y); break
				case 'cmp/ge': bit(c, T, (x | 0) >= (y | 0)); break
				case 'cmp/gt': bit(c, T, (x | 0) > (y | 0)); break
				case 'cmp/str': { const d = x ^ y; bit(c, T, [0, 8, 16, 24].some(shift => (d >>> shift & 255) === 0)); break }
				case 'extu.b': result = y & 255; break
				case 'extu.w': result = y & 65535; break
				case 'exts.b': result = signed(y, 8); break
				case 'exts.w': result = signed(y, 16); break
				case 'swap.b': result = y & 0xffff0000 | (y & 255) << 8 | y >>> 8 & 255; break
				case 'swap.w': result = y << 16 | y >>> 16; break
				case 'xtrct': result = x >>> 16 | y << 16; break
				case 'mulu.w': c.r[MACL] = (x & 65535) * (y & 65535); break
				case 'muls.w': c.r[MACL] = signed(x, 16) * signed(y, 16); break
				case 'mul.l': c.r[MACL] = Math.imul(x, y); break
				case 'dmulu.l': case 'dmuls.l': { const product = BigInt(name === 'dmuls.l' ? x | 0 : x) * BigInt(name === 'dmuls.l' ? y | 0 : y); c.r[MACL] = Number(BigInt.asUintN(32, product)); c.r[MACH] = Number(BigInt.asUintN(32, product >> 32n)); break }
				case 'div0s': bit(c, Q, !!(x & 0x80000000)); bit(c, M, !!(y & 0x80000000)); bit(c, T, !!(c.r[SR] & Q) !== !!(c.r[SR] & M)); break
				case 'div1': { const oldQ = !!(c.r[SR] & Q), divisorSign = !!(c.r[SR] & M), sign = !!(x & 0x80000000), shifted = x << 1 | carry, unsigned = shifted >>> 0, subtract = oldQ === divisorSign, full = subtract ? unsigned - y : unsigned + y; result = full >>> 0; const carryOut = subtract ? unsigned < y : full > 0xffffffff; bit(c, Q, divisorSign ? sign === carryOut : sign !== carryOut); bit(c, T, !!(c.r[SR] & Q) === divisorSign); break }
			}
			if (!compare && !multiply && name !== 'div0s') c.r[n] = result
		})
	}
	throw new Error(`Illegal ${model.toUpperCase()} opcode 0x${w.toString(16)}`)
}
