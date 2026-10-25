import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'
import { A, B, X, SP, CC, Y, U, DP, D, C, V, Z, N, I, H, flag, nz, arithmetic, arithmetic16, branchCondition, unaryValue, getD, setD, readWord, writeWord, push, pop, pushWord, popWord, monitor } from './operations'

// Mirrors: https://archive.org/download/bitsavers_motorola68_13419254/M6809PM.rev0_May83.pdf (byte-identical)
// Mirrors: https://www.maddes.net/m6809pm/index.htm (HTML transcription; Appendix A anchors per instruction instead of pages)
export const reference = 'https://bitsavers.org/components/motorola/6809/M6809PM.rev0_May83.pdf'
const branches = ['bra', 'brn', 'bhi', 'bls', 'bcc', 'bcs', 'bne', 'beq', 'bvc', 'bvs', 'bpl', 'bmi', 'bge', 'blt', 'bgt', 'ble']
const unary: Record<string, number> = { neg: 0, com: 3, lsr: 4, ror: 6, asr: 7, asl: 8, rol: 9, dec: 10, inc: 12, tst: 13, jmp: 14, clr: 15 }
const inherent: Record<string, number> = { nop: 0x12, sync: 0x13, daa: 0x19, sex: 0x1d, rts: 0x39, abx: 0x3a, rti: 0x3b, mul: 0x3d, swi: 0x3f, swi2: 0x103f, swi3: 0x113f }
const alu: Record<string, [number, number, number]> = {
	suba: [0x80, A, 8], cmpa: [0x81, A, 8], sbca: [0x82, A, 8], subd: [0x83, D, 16], anda: [0x84, A, 8], bita: [0x85, A, 8], lda: [0x86, A, 8], sta: [0x87, A, 8], eora: [0x88, A, 8], adca: [0x89, A, 8], ora: [0x8a, A, 8], adda: [0x8b, A, 8], cmpx: [0x8c, X, 16], ldx: [0x8e, X, 16], stx: [0x8f, X, 16],
	subb: [0xc0, B, 8], cmpb: [0xc1, B, 8], sbcb: [0xc2, B, 8], addd: [0xc3, D, 16], andb: [0xc4, B, 8], bitb: [0xc5, B, 8], ldb: [0xc6, B, 8], stb: [0xc7, B, 8], eorb: [0xc8, B, 8], adcb: [0xc9, B, 8], orb: [0xca, B, 8], addb: [0xcb, B, 8], ldd: [0xcc, D, 16], std: [0xcd, D, 16], ldu: [0xce, U, 16], stu: [0xcf, U, 16],
	cmpd: [0x1083, D, 16], cmpy: [0x108c, Y, 16], ldy: [0x108e, Y, 16], sty: [0x108f, Y, 16], lds: [0x10ce, SP, 16], sts: [0x10cf, SP, 16], cmpu: [0x1183, U, 16], cmps: [0x118c, SP, 16],
}
const aliases: Record<string, string> = { ldaa: 'lda', ldab: 'ldb', staa: 'sta', stab: 'stb', oraa: 'ora', orab: 'orb', cpx: 'cmpx', bhs: 'bcc', blo: 'bcs', lbhs: 'lbcc', lblo: 'lbcs', lsl: 'asl', lsla: 'asla', lslb: 'aslb' }
const normal = (name: string) => aliases[name.toLowerCase()] ?? name.toLowerCase()
export const instructions = [...Object.keys(inherent), ...Object.keys(alu), ...Object.keys(aliases), ...branches, ...branches.map(n => `l${n}`), 'bsr', 'lbsr', 'jsr', 'orcc', 'andcc', 'exg', 'tfr', 'pshs', 'puls', 'pshu', 'pulu', 'leax', 'leay', 'leas', 'leau', 'cwai', ...Object.keys(unary), ...Object.keys(unary).filter(n => n !== 'jmp').flatMap(n => [n + 'a', n + 'b'])]
const word = (n: number) => [n >>> 8 & 255, n & 255]
function fit(n: number, min: number, max: number) { if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Operand must be ${min} through ${max}`); return n }
function indexBytes(operands: readonly string[], context?: CpuEncodingContext, before = 1): number[] {
	let text = operands.join(',').replace(/\s/g, ''), indirect = false
	if (text.startsWith('[') && text.endsWith(']')) { text = text.slice(1, -1); indirect = true }
	const evaluate = (s: string) => context ? context.value(s) : Number(s.replace(/^\$/, '0x'))
	if (!text.includes(',')) { if (!indirect) throw new Error('Expected indexed addressing'); return [0x9f, ...word(context ? fit(evaluate(text), 0, 65535) : 0)] }
	const [offset, rawBase] = text.split(',')
	const base = rawBase.toLowerCase()
	const m = /^(--?)([xyus])$|^([xyus])(\+\+?)?$|^(pcr?|pc)$/.exec(base)
	if (!m) throw new Error('Invalid 6809 index register')
	const register = m[2] ?? m[3], r = register ? 'xyus'.indexOf(register) << 5 : 0, ind = indirect ? 16 : 0
	if (m[1] || m[4]) {
		if (offset || indirect && (m[1]?.length === 1 || m[4]?.length === 1)) throw new Error('Invalid auto-index form')
		return [0x80 | r | ind | (m[1] ? m[1].length === 1 ? 2 : 3 : m[4]!.length === 1 ? 0 : 1)]
	}
	if (!register) {
		const wide = !offset.startsWith('<'), size = wide ? 3 : 2
		const displacement = context ? evaluate(offset.replace(/^[<>]/, '')) - (context.address + before + size) << 16 >> 16 : 0
		return [0x80 | ind | (wide ? 13 : 12), ...(wide ? word(displacement) : [fit(displacement, -128, 127) & 255])]
	}
	if (!offset) return [0x84 | r | ind]
	if (['a', 'b', 'd'].includes(offset.toLowerCase())) return [0x80 | r | ind | ({ a: 6, b: 5, d: 11 })[offset.toLowerCase() as 'a']]
	const constant = Number(offset.replace(/^\$/, '0x')), forced = offset[0]
	const mode = forced === '<' ? 8 : forced === '>' ? 9 : Number.isInteger(constant) ? !indirect && constant >= -16 && constant <= 15 ? 5 : constant >= -128 && constant <= 127 ? 8 : 9 : 9
	const n = context ? evaluate(offset.replace(/^[<>]/, '')) : 0
	if (mode === 5) return [r | fit(n, -16, 15) & 31]
	return [0x80 | r | ind | mode, ...(mode === 8 ? [fit(n, -128, 127) & 255] : word(fit(n, -32768, 65535)))]
}
const indexed = (args: readonly string[]) => args.length > 1 || args[0]?.startsWith('[')
export function instructionSize(mnemonic: string, args: readonly string[]): number {
	const n = normal(mnemonic)
	if (n in inherent) return inherent[n] > 255 ? 2 : 1
	if (branches.includes(n) || n === 'bsr' || ['orcc', 'andcc', 'exg', 'tfr', 'pshs', 'puls', 'pshu', 'pulu', 'cwai'].includes(n)) return 2
	if (n === 'lbra' || n === 'lbsr') return 3
	if (n.startsWith('l') && branches.includes(n.slice(1))) return 4
	if (/^lea[xyus]$/.test(n)) return 1 + indexBytes(args).length
	if (n.slice(0, -1) in unary && /[ab]$/.test(n) && n !== 'jmp') return 1
	if (!(n in alu || n in unary || n === 'jsr')) throw new Error(`Unknown 6809 instruction ${n}`)
	const prefix = n in alu && alu[n][0] > 255 ? 1 : 0
	return 1 + prefix + (indexed(args) ? indexBytes(args).length : args[0]?.startsWith('#') ? n in alu && alu[n][2] === 16 ? 2 : 1 : args[0]?.startsWith('<') ? 1 : 2)
}
const transferRegisters: Record<string, [number, number]> = { d: [0, 16], x: [1, 16], y: [2, 16], u: [3, 16], s: [4, 16], sp: [4, 16], pc: [5, 16], a: [8, 8], b: [9, 8], cc: [10, 8], dp: [11, 8] }
export function encode(mnemonic: string, args: readonly string[], c: CpuEncodingContext): number[] {
	const n = normal(mnemonic), size = instructionSize(n, args)
	if (n in inherent) { if (args.length) throw new Error(`${n} takes no operands`); return inherent[n] > 255 ? word(inherent[n]) : [inherent[n]] }
	if (branches.includes(n) || n === 'bsr' || n === 'lbsr' || n.startsWith('l') && branches.includes(n.slice(1))) {
		if (args.length !== 1) throw new Error('Branch requires one target')
		const delta = c.value(args[0]) - c.address - size << 16 >> 16
		if (size === 2) return [n === 'bsr' ? 0x8d : 0x20 + branches.indexOf(n), fit(delta, -128, 127) & 255]
		return [...(n === 'lbra' ? [0x16] : n === 'lbsr' ? [0x17] : [0x10, 0x20 + branches.indexOf(n.slice(1))]), ...word(delta)]
	}
	if (n === 'exg' || n === 'tfr') {
		const from = transferRegisters[args[0]?.toLowerCase()], to = transferRegisters[args[1]?.toLowerCase()]
		if (args.length !== 2 || !from || !to || from[1] !== to[1]) throw new Error('TFR/EXG require two registers of equal width')
		return [n === 'exg' ? 0x1e : 0x1f, from[0] << 4 | to[0]]
	}
	if (/^(psh|pul)[su]$/.test(n)) {
		const names = ['cc', 'a', 'b', 'dp', 'x', 'y', n.endsWith('s') ? 'u' : 's', 'pc']
		let mask = 0
		for (const name of args.flatMap(n => n.toLowerCase().split(/\s+/))) { if (name === 'd') { mask |= 6; continue } const bit = names.indexOf(name === 'sp' ? 's' : name); if (bit < 0) throw new Error('Invalid stack register list'); mask |= 1 << bit }
		if (!mask) throw new Error('Stack operation needs a register list')
		return [({ pshs: 0x34, puls: 0x35, pshu: 0x36, pulu: 0x37 })[n]!, mask]
	}
	if (['orcc', 'andcc', 'cwai'].includes(n)) { if (args.length !== 1 || !args[0].startsWith('#')) throw new Error('Expected immediate mask'); return [({ orcc: 0x1a, andcc: 0x1c, cwai: 0x3c })[n]!, fit(c.value(args[0].slice(1)), -128, 255) & 255] }
	if (/^lea[xyus]$/.test(n)) return [0x30 + 'xy su'.replace(' ', '').indexOf(n[3]), ...indexBytes(args, c)]
	const base = n.slice(0, -1)
	if (base in unary && /[ab]$/.test(n)) { if (args.length) throw new Error('Accumulator operation takes no operands'); return [(n.endsWith('a') ? 0x40 : 0x50) + unary[base]] }
	const immediate = args[0]?.startsWith('#'), direct = args[0]?.startsWith('<'), ix = indexed(args)
	if (!ix && args.length !== 1) throw new Error('Expected one operand')
	if (immediate && (n.startsWith('st') || n in unary || n === 'jsr')) throw new Error('No immediate form')
	const original = n in alu ? alu[n][0] : n === 'jsr' ? 0x8d : unary[n], prefix = original > 255 ? [original >>> 8] : []
	const opcode = n in unary ? unary[n] + (ix ? 0x60 : direct ? 0 : 0x70) : (original & 255) + (immediate ? 0 : direct ? 0x10 : ix ? 0x20 : 0x30)
	const operand = ix ? indexBytes(args, c, 1 + prefix.length) : (() => { const count = size - 1 - prefix.length, value = fit(c.value(args[0].replace(/^[#<>]/, '')), immediate ? count === 1 ? -128 : -32768 : 0, count === 1 ? 255 : 65535); return count === 1 ? [value & 255] : word(value) })()
	return [...prefix, opcode, ...operand]
}
function decodeIndex(memory: Uint8Array, at: number) {
	const p = memory[at & 65535], r = [X, Y, U, SP][p >>> 5 & 3], names = ['X', 'Y', 'U', 'S'], rn = names[p >>> 5 & 3], indirect = !!(p & 16), low = p & 15
	let bytes = 1
	let text: string, effective: (c: CpuContext) => number
	if (!(p & 128)) { const offset = p << 27 >> 27; text = `${offset},${rn}`; effective = c => c.r[r] + offset & 65535 }
	else {
		const b = memory[at + 1 & 65535], w = b << 8 | memory[at + 2 & 65535], signed = low === 8 || low === 12 ? b << 24 >> 24 : w << 16 >> 16
		if ([7, 10, 14].includes(low) || indirect && (low === 0 || low === 2) || low === 15 && p !== 0x9f) throw new Error('Illegal 6809 indexed postbyte')
		bytes = [8, 12].includes(low) ? 2 : [9, 13, 15].includes(low) ? 3 : 1
		text = low < 4 ? `,${low >= 2 ? '-'.repeat(low === 2 ? 1 : 2) : ''}${rn}${low < 2 ? '+'.repeat(low + 1) : ''}` : low === 4 ? `,${rn}` : low === 5 || low === 6 || low === 11 ? `${low === 5 ? 'B' : low === 6 ? 'A' : 'D'},${rn}` : low === 15 ? `$${w.toString(16)}` : `${signed},${low === 12 || low === 13 ? 'PCR' : rn}`
		if (low === 8 || low === 9) text = `${low === 8 ? '<' : '>'}${signed},${rn}`
		if (low === 12 || low === 13) text = `${low === 12 ? '<' : '>'}$${(at + bytes + signed & 65535).toString(16)},PCR`
		effective = c => {
			let address = c.r[r]
			if (low < 4) { if (low >= 2) address = c.r[r] = address - (low === 2 ? 1 : 2) & 65535; else c.r[r] = address + low + 1 & 65535 }
			else if (low === 5 || low === 6) address += c.r[low === 5 ? B : A] << 24 >> 24
			else if (low === 11) address += getD(c) << 16 >> 16
			else if (low === 8 || low === 9) address += signed
			else if (low === 12 || low === 13) address = at + bytes + signed
			else if (low === 15) address = w
			address &= 65535
			return indirect ? readWord(c, address) : address
		}
		if (indirect) text = `[${text}]`
	}
	return { bytes, text, effective }
}
const get = (c: CpuContext, r: number) => r === D ? getD(c) : c.r[r]
function put(c: CpuContext, r: number, value: number) { if (r === D) setD(c, value); else c.r[r] = value }
const tfrIds = [D, X, Y, U, SP, -1, -2, -2, A, B, CC, DP]
export function decode(memory: Uint8Array, address: number): CpuInstruction {
	let at = address, page = 0, op = memory[at++ & 65535]
	if (op === 0x10 || op === 0x11) { page = op << 8; op = memory[at++ & 65535] }
	const code = page | op, prefix = at - address, byte = memory[at & 65535], w = byte << 8 | memory[at + 1 & 65535]
	const make = (size: number, text: string, execute: CpuInstruction['execute'], kind: CpuInstruction['kind'] = 'alu', call = false): CpuInstruction => ({ size, text: text.toUpperCase(), execute, kind, call })
	const named = Object.keys(inherent).find(n => inherent[n] === code)
	if (named) return make(prefix, named, c => {
		switch (named) {
			case 'nop': break
			case 'sync': throw new Error('6809 SYNC requires an external interrupt source')
			case 'daa': { const a = c.r[A], correction = (a & 15) > 9 || c.r[CC] & H ? 6 : 0, high = a > 0x99 || c.r[CC] & C ? 0x60 : 0; c.r[A] = nz(c, a + correction + high); if (high) flag(c, C, true); break }
			case 'sex': c.r[A] = c.r[B] & 128 ? 255 : 0; nz(c, getD(c), 16); break
			case 'abx': c.r[X] = c.r[X] + c.r[B] & 65535; break
			case 'mul': { const product = c.r[A] * c.r[B]; setD(c, product); flag(c, Z, product === 0); flag(c, C, !!(product & 128)); break }
			case 'rts': c.ret(popWord(c, SP, true)); break
			case 'rti': { c.r[CC] = pop(c, SP, true); if (c.r[CC] & 128) { c.r[A] = pop(c, SP, true); c.r[B] = pop(c, SP, true); c.r[DP] = pop(c, SP, true); c.r[X] = popWord(c, SP, true); c.r[Y] = popWord(c, SP, true); c.r[U] = popWord(c, SP, true) } c.ret(popWord(c, SP, true)); break }
			case 'swi': monitor(c); break
			default: throw new Error(`6809 ${named.toUpperCase()} native trap delivery is not modeled`)
		}
	}, named === 'rts' || named === 'rti' ? 'return' : named.startsWith('swi') ? 'system' : 'alu')
	if ((!page || page === 0x1000) && op >= 0x20 && op <= 0x2f || !page && [0x16, 0x17, 0x8d].includes(op)) {
		const wide = !!page || op === 0x16 || op === 0x17, size = prefix + (wide ? 2 : 1), target = address + size + (wide ? w << 16 >> 16 : byte << 24 >> 24) & 65535, call = !page && (op === 0x17 || op === 0x8d), condition = op === 0x16 ? 0 : op & 15
		return make(size, `${call ? wide ? 'lbsr' : 'bsr' : wide ? `l${branches[condition]}` : branches[condition]} $${target.toString(16)}`, c => {
			if (call) { pushWord(c, c.pc, SP, true); c.call(target); return }
			const taken = branchCondition(c, condition)
			if (condition === 0) c.pc = target; else c.branch(target, taken)
		}, call ? 'call' : condition === 0 ? 'jump' : 'branch', call)
	}
	if (!page && [0x1a, 0x1c, 0x3c].includes(op)) return make(2, `${op === 0x1a ? 'orcc' : op === 0x1c ? 'andcc' : 'cwai'} #$${byte.toString(16)}`, c => { if (op === 0x3c) throw new Error('6809 CWAI requires external interrupt delivery'); c.r[CC] = op === 0x1a ? c.r[CC] | byte : c.r[CC] & byte })
	if (!page && (op === 0x1e || op === 0x1f)) {
		const from = byte >>> 4, to = byte & 15
		if (tfrIds[from] === undefined || tfrIds[to] === undefined || tfrIds[from] === -2 || tfrIds[to] === -2 || (from < 8) !== (to < 8)) throw new Error('Illegal 6809 transfer register pair')
		const name = (id: number) => Object.keys(transferRegisters).find(n => transferRegisters[n][0] === id)!
		return make(2, `${op === 0x1e ? 'exg' : 'tfr'} ${name(from)},${name(to)}`, c => { const read = (id: number) => id === 5 ? c.pc : get(c, tfrIds[id]), write = (id: number, value: number) => { if (id === 5) c.pc = value; else put(c, tfrIds[id], value) }; const old = read(from), other = read(to); write(to, old); if (op === 0x1e) write(from, other) }, to === 5 || op === 0x1e && from === 5 ? 'jump' : 'alu')
	}
	if (!page && op >= 0x34 && op <= 0x37) {
		const stack = op & 2 ? U : SP, ids = [CC, A, B, DP, X, Y, stack === U ? SP : U, -1], pull = !!(op & 1)
		return make(2, `${pull ? 'pul' : 'psh'}${stack === SP ? 's' : 'u'} ${ids.flatMap((id, bit) => byte & 1 << bit ? [id === -1 ? 'pc' : ['a', 'b', 'x', 's', 'cc', 'y', 'u', 'dp'][id]] : []).join(',')}`, c => {
			for (let i = 0; i < 8; i++) { const bit = pull ? i : 7 - i; if (!(byte & 1 << bit)) continue; const id = ids[bit]; if (pull) { const v = bit < 4 ? pop(c, stack, true) : popWord(c, stack, true); if (id === -1) c.ret(v); else c.r[id] = v } else { const v = id === -1 ? c.pc : c.r[id]; if (bit < 4) push(c, v, stack, true); else pushWord(c, v, stack, true) } }
		}, pull && byte & 128 ? 'return' : 'alu')
	}
	if (!page && op >= 0x30 && op <= 0x33) { const ix = decodeIndex(memory, at), r = [X, Y, SP, U][op & 3]; return make(1 + ix.bytes, `lea${['x', 'y', 's', 'u'][op & 3]} ${ix.text}`, c => { c.r[r] = ix.effective(c); if (r === X || r === Y) flag(c, Z, c.r[r] === 0) }) }
	const low = op & 15, group = op >>> 4, unaryName = Object.keys(unary).find(n => unary[n] === low)
	if (!page && unaryName && [0, 4, 5, 6, 7].includes(group) && !(low === 14 && (group === 4 || group === 5))) {
		const ix = group === 6 ? decodeIndex(memory, at) : null, size = group === 0 ? 2 : group < 6 ? 1 : ix ? 1 + ix.bytes : 3
		return make(size, `${unaryName}${group === 4 ? 'a' : group === 5 ? 'b' : ` ${ix?.text ?? `$${(group === 0 ? byte : w).toString(16)}`}`}`, c => { const ea = ix ? ix.effective(c) : group === 0 ? c.r[DP] << 8 | byte : w; if (low === 14) { c.pc = ea; return } const r = group === 4 ? A : B, register = group === 4 || group === 5, old = register ? c.r[r] : c.read(ea), carry = c.r[CC] & C, overflow = c.r[CC] & V, value = unaryValue(c, low, old); if ([4, 6, 7].includes(low)) flag(c, V, !!overflow); if (low === 13) flag(c, C, !!carry); if (low !== 13) { if (register) c.r[r] = value; else c.write(ea, value) } }, low === 14 ? 'jump' : 'alu')
	}
	if (op >= 0x80) {
		const mode = group & 3, base = code - mode * 16, name = Object.keys(alu).find(n => alu[n][0] === base), isCall = !page && [0x9d, 0xad, 0xbd].includes(op)
		if (name || isCall) {
			const store = name?.startsWith('st'), bits = name ? alu[name][2] : 16, r = name ? alu[name][1] : 0, ix = mode === 2 ? decodeIndex(memory, at) : null
			if (mode === 0 && store) throw new Error('Illegal immediate store')
			const size = prefix + (ix ? ix.bytes : mode === 3 || mode === 0 && bits === 16 ? 2 : 1)
			return make(size, `${name ?? 'jsr'} ${ix?.text ?? `${mode === 0 ? '#' : ''}$${(size - prefix === 2 ? w : byte).toString(16)}`}`, c => {
				const ea = ix ? ix.effective(c) : mode === 1 ? c.r[DP] << 8 | byte : w
				if (isCall) { pushWord(c, c.pc, SP, true); c.call(ea); return }
				const left = get(c, r)
				if (store) { if (bits === 16) writeWord(c, ea, left); else c.write(ea, left); nz(c, left, bits); flag(c, V, false); return }
				const value = mode === 0 ? bits === 16 ? w : byte : bits === 16 ? readWord(c, ea) : c.read(ea)
				let result = value
				if (name!.startsWith('ld')) { nz(c, value, bits); flag(c, V, false) }
				else if (bits === 16) result = arithmetic16(c, left, value, name !== 'addd')
				else if (low <= 2 || low === 9 || low === 11) result = arithmetic(c, left, value, low <= 2, low === 2 || low === 9 ? c.r[CC] & C : 0)
				else { result = low === 4 || low === 5 ? left & value : low === 8 ? left ^ value : left | value; result = nz(c, result); flag(c, V, false) }
				if (!name!.startsWith('cmp') && low !== 1 && low !== 5) put(c, r, result)
			}, isCall ? 'call' : store ? 'store' : name!.startsWith('ld') ? 'load' : 'alu', isCall)
		}
	}
	throw new Error(`Illegal 6809 opcode $${code.toString(16)} at $${address.toString(16)}`)
}
