import type { CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'
import * as base from './isa'
import { A, B, X, SP, CC, Y, D, C, V, Z, N, flag, nz, arithmetic16, getD, setD, readWord, writeWord, pushWord, pop, popWord } from './operations'

export const reference = 'https://www.nxp.com/docs/en/reference-manual/M68HC11RM.pdf'
const inherent: Record<string, number> = { idiv: 2, fdiv: 3, lsrd: 4, asld: 5, abx: 0x3a, aby: 0x183a, pulx: 0x38, puly: 0x1838, pshx: 0x3c, pshy: 0x183c, mul: 0x3d, xgdx: 0x8f, xgdy: 0x188f, iny: 0x1808, dey: 0x1809, tsy: 0x1830, tys: 0x1835, stop: 0xcf }
const wide: Record<string, [number, number]> = { subd: [0x83, D], addd: [0xc3, D], ldd: [0xcc, D], std: [0xcd, D], cpx: [0x8c, X], cpy: [0x188c, Y], cpd: [0x1a83, D], ldx: [0xce, X], stx: [0xcf, X], ldy: [0x18ce, Y], sty: [0x18cf, Y] }
const aliases: Record<string, string> = { lsld: 'asld', lda: 'ldaa', ldb: 'ldab', sta: 'staa', stb: 'stab', ora: 'oraa', orb: 'orab', cmpx: 'cpx', cmpy: 'cpy', cmpd: 'cpd' }
const normal = (name: string) => aliases[name.toLowerCase()] ?? name.toLowerCase()
export const instructions = [...new Set([...base.instructions, ...Object.keys(inherent), ...Object.keys(wide), ...Object.keys(aliases), 'brn', 'bset', 'bclr', 'brset', 'brclr'])]
const word = (n: number) => [n >>> 8 & 255, n & 255]
function fit(n: number, min: number, max: number) { if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Operand must be ${min} through ${max}`); return n }
const index = (args: readonly string[]) => /^[xy]$/i.test(args[1] ?? '') ? args[1].toLowerCase() : null
function widePrefix(name: string, ix: string | null) {
	if (ix === 'y') return ['cpx', 'ldx', 'stx', 'cpd'].includes(name) ? [0xcd] : [0x18]
	if (ix === 'x' && ['cpy', 'ldy', 'sty'].includes(name)) return [0x1a]
	return wide[name][0] > 255 ? [wide[name][0] >>> 8] : []
}
export function instructionSize(mnemonic: string, args: readonly string[]) {
	const n = normal(mnemonic), ix = index(args)
	if (n in inherent) return inherent[n] > 255 ? 2 : 1
	if (n === 'brn') return 2
	if (['bset', 'bclr', 'brset', 'brclr'].includes(n)) return (n.startsWith('br') ? 4 : 3) + (ix === 'y' ? 1 : 0)
	if (n in wide) return widePrefix(n, ix).length + (ix || args[0]?.startsWith('<') ? 2 : 3)
	if (n === 'jsr' && args[0]?.startsWith('<')) return 2
	return base.instructionSize(n, ix === 'y' ? [args[0], 'x'] : args) + (ix === 'y' ? 1 : 0)
}
export function encode(mnemonic: string, args: readonly string[], c: CpuEncodingContext): number[] {
	const n = normal(mnemonic), ix = index(args), size = instructionSize(n, args)
	if (n in inherent) { if (args.length) throw new Error('Inherent operation takes no operands'); return inherent[n] > 255 ? word(inherent[n]) : [inherent[n]] }
	if (n === 'brn') { if (args.length !== 1) throw new Error('BRN needs a target'); return [0x21, fit(c.value(args[0]) - c.address - 2 << 16 >> 16, -128, 127) & 255] }
	if (['bset', 'bclr', 'brset', 'brclr'].includes(n)) {
		if (args.length !== (ix ? n.startsWith('br') ? 4 : 3 : n.startsWith('br') ? 3 : 2)) throw new Error('Expected address[,X|Y], mask[,target]')
		const at = fit(c.value(args[0].replace(/^</, '')), 0, 255), mask = fit(c.value(args[ix ? 2 : 1].replace(/^#/, '')), 0, 255), op = ({ bset: 0x14, bclr: 0x15, brset: 0x12, brclr: 0x13 })[n]! + (ix ? n.startsWith('br') ? 12 : 8 : 0)
		return [...(ix === 'y' ? [0x18] : []), op, at, mask, ...(n.startsWith('br') ? [fit(c.value(args[args.length - 1]) - c.address - size << 16 >> 16, -128, 127) & 255] : [])]
	}
	if (n in wide) {
		if (args.length !== (ix ? 2 : 1)) throw new Error('Invalid word operand')
		const immediate = args[0].startsWith('#'), direct = args[0].startsWith('<'), prefix = widePrefix(n, ix), op = (wide[n][0] & 255) + (immediate ? 0 : ix ? 32 : direct ? 16 : 48)
		if (n.startsWith('st') && immediate) throw new Error('No immediate store')
		const value = fit(c.value(args[0].replace(/^[#<>]/, '')), immediate ? -32768 : 0, size - prefix.length === 2 ? 255 : 65535)
		return [...prefix, op, ...(size - prefix.length === 2 ? [value & 255] : word(value))]
	}
	if (n === 'jsr' && args[0]?.startsWith('<')) return [0x9d, fit(c.value(args[0].slice(1)), 0, 255)]
	const bytes = base.encode(n, ix === 'y' ? [args[0], 'x'] : args, c)
	return ix === 'y' ? [0x18, ...bytes] : bytes
}
export function decode(memory: Uint8Array, address: number): CpuInstruction {
	let page = 0, at = address, op = memory[at++ & 65535]
	if ([0x18, 0x1a, 0xcd].includes(op)) { page = op; op = memory[at++ & 65535] }
	const byte = memory[at & 65535], w = byte << 8 | memory[at + 1 & 65535], prefix = at - address
	const make = (size: number, text: string, execute: CpuInstruction['execute'], kind: CpuInstruction['kind'] = 'alu', call = false): CpuInstruction => ({ size, text: text.toUpperCase(), execute, kind, call })
	const name = Object.keys(inherent).find(n => inherent[n] === (page << 8 | op))
	if (name) return make(prefix, name, c => {
		const r = name.endsWith('y') ? Y : X
		switch (name) {
			case 'idiv': case 'fdiv': { const numerator = getD(c), denominator = c.r[X], overflow = name === 'fdiv' && numerator >= denominator, scaled = numerator * (name === 'fdiv' ? 65536 : 1); flag(c, C, denominator === 0); flag(c, V, overflow); c.r[X] = denominator === 0 || overflow ? 65535 : Math.floor(scaled / denominator); if (denominator && !overflow) setD(c, scaled % denominator); flag(c, Z, c.r[X] === 0); break }
			case 'lsrd': case 'asld': { const old = getD(c), left = name === 'asld', result = left ? old << 1 : old >>> 1; setD(c, nz(c, result, 16)); flag(c, C, !!(old & (left ? 0x8000 : 1))); flag(c, V, !!(c.r[CC] & N) !== !!(c.r[CC] & C)); break }
			case 'mul': { const product = c.r[A] * c.r[B]; setD(c, product); flag(c, C, !!(product & 128)); break }
			case 'abx': case 'aby': c.r[r] = c.r[r] + c.r[B] & 65535; break
			case 'pulx': case 'puly': c.r[r] = popWord(c); break
			case 'pshx': case 'pshy': pushWord(c, c.r[r]); break
			case 'xgdx': case 'xgdy': { const old = getD(c); setD(c, c.r[r]); c.r[r] = old; break }
			case 'iny': case 'dey': c.r[Y] = c.r[Y] + (name === 'iny' ? 1 : -1) & 65535; flag(c, Z, c.r[Y] === 0); break
			case 'tsy': c.r[Y] = c.r[SP] + 1 & 65535; break
			case 'tys': c.r[SP] = c.r[Y] - 1 & 65535; break
			case 'stop': if (!(c.r[CC] & 128)) throw new Error('68HC11 STOP requires an external wakeup source'); break
		}
	})
	if (!page && (op === 6 || op === 7)) return make(1, op === 6 ? 'tap' : 'tpa', c => { if (op === 6) c.r[CC] = c.r[A] & (c.r[CC] | ~64); else c.r[A] = c.r[CC] })
	if (!page && op === 0x3b) return make(1, 'rti', c => { c.r[CC] = pop(c); c.r[B] = pop(c); c.r[A] = pop(c); c.r[X] = popWord(c); c.r[Y] = popWord(c); c.ret(popWord(c)) }, 'return')
	if (!page && op === 0x21) return make(2, `brn $${(address + 2 + (byte << 24 >> 24) & 65535).toString(16)}`, c => c.branch(address + 2 + (byte << 24 >> 24) & 65535, false), 'branch')
	if ((page === 0 || page === 0x18) && [0x12, 0x13, 0x14, 0x15, 0x1c, 0x1d, 0x1e, 0x1f].includes(op) && (!page || op >= 0x1c)) {
		const ix = op >= 0x1c, branch = op === 0x12 || op === 0x13 || op >= 0x1e, clear = !!(op & 1), mask = memory[at + 1 & 65535], size = prefix + (branch ? 3 : 2), target = address + size + (memory[at + 2 & 65535] << 24 >> 24) & 65535, r = page ? Y : X
		return make(size, `${branch ? 'br' : 'b'}${clear ? 'clr' : 'set'} $${byte.toString(16)}${ix ? r === X ? ',X' : ',Y' : ''},#$${mask.toString(16)}${branch ? `,$${target.toString(16)}` : ''}`, c => { const ea = ix ? c.r[r] + byte & 65535 : byte, old = c.read(ea); if (branch) c.branch(target, clear ? (old & mask) === 0 : (old & mask) === mask); else { const value = clear ? old & ~mask : old | mask; c.write(ea, nz(c, value)); flag(c, V, false) } }, branch ? 'branch' : 'store')
	}
	if (!page && op === 0x9d) return make(2, `jsr <$${byte.toString(16)}`, c => { pushWord(c, c.pc); c.call(byte) }, 'call', true)
	const mode = op >>> 4 & 3
	const wideName = Object.keys(wide).find(n => {
		const ix = mode === 2 ? page === 0x18 && !['cpx', 'ldx', 'stx', 'cpd'].includes(n) || page === 0xcd ? 'y' : 'x' : null
		const p = widePrefix(n, ix)
		return (wide[n][0] & 255) + mode * 16 === op && (p[0] ?? 0) === page
	})
	if (wideName && op >= 0x80) {
		const store = wideName.startsWith('st'), reg = wide[wideName][1], ix = mode === 2 ? page === 0x18 || page === 0xcd ? Y : X : null
		if (store && mode === 0) throw new Error('Illegal immediate store')
		const size = prefix + (mode === 0 || mode === 3 ? 2 : 1)
		return make(size, `${wideName} ${mode === 0 ? '#' : ''}$${(size - prefix === 2 ? w : byte).toString(16)}${ix ? ix === X ? ',X' : ',Y' : ''}`, c => { const ea = ix ? c.r[ix] + byte & 65535 : mode === 1 ? byte : w, left = reg === D ? getD(c) : c.r[reg]; if (store) { writeWord(c, ea, left); nz(c, left, 16); flag(c, V, false); return } const value = mode === 0 ? w : readWord(c, ea); let result: number; if (wideName.startsWith('ld')) { result = nz(c, value, 16); flag(c, V, false) } else result = arithmetic16(c, left, value, wideName !== 'addd'); if (!wideName.startsWith('cp')) { if (reg === D) setD(c, result); else c.r[reg] = result } }, store ? 'store' : wideName.startsWith('ld') ? 'load' : 'alu')
	}
	if (page && !(page === 0x18 && (op >= 0x60 && op <= 0x6f || mode === 2 && op >= 0x80))) throw new Error('Illegal 68HC11 prefix/opcode combination')
	const decoded = base.decode(memory, address + (page ? 1 : 0) & 65535, page ? Y : X)
	return page ? { ...decoded, size: decoded.size + 1, text: decoded.text.replace(/,X\b/g, ',Y') } : decoded
}
