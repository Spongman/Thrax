import type { InstructionInfo } from '../contracts'
import type { Instruction } from './isa'

export const DEPENDENCY_NAMES = [...Array.from({ length: 32 }, (_, n) => `r${n}`), 'SREG', 'SP']
const SREG = 32, SP = 33
const arithmetic = new Set(['add', 'adc', 'sub', 'sbc', 'cp', 'cpc', 'subi', 'sbci', 'cpi', 'and', 'andi', 'or', 'ori', 'eor', 'com', 'neg', 'inc', 'dec', 'lsr', 'asr', 'ror', 'mul'])
const compare = new Set(['cp', 'cpc', 'cpi'])
const cache = new WeakMap<Instruction, InstructionInfo>()

export function describeAvrInstruction(i: Instruction): InstructionInfo {
	const cached = cache.get(i)
	if (cached) return cached
	const reads = new Set<number>(), writes = new Set<number>(), loaded = new Set<number>()
	const read = (...r: number[]) => { for (const n of r) reads.add(n) }
	const write = (...r: number[]) => { for (const n of r) writes.add(n) }
	const load = (n: number) => { write(n); loaded.add(n) }
	const alias = (address: number) => address < 32 ? address : address === 0x5f ? SREG : address === 0x5d || address === 0x5e ? SP : undefined
	const stack = () => { read(SP); write(SP) }
	const d = i.d ?? 0, k = i.k ?? 0
	if (arithmetic.has(i.name)) {
		read(d, SREG)
		if (i.r !== undefined) read(i.r)
		write(SREG)
		if (i.name === 'mul') write(0, 1)
		else if (!compare.has(i.name)) write(d)
	} else switch (i.name) {
		case 'ldi': write(d); break
		case 'mov': read(i.r!); write(d); break
		case 'swap': read(d); write(d); break
		case 'bset': case 'bclr': read(SREG); write(SREG); break
		case 'bst': read(d, SREG); write(SREG); break
		case 'bld': read(d, SREG); write(d); break
		case 'push': read(d); stack(); break
		case 'pop': stack(); load(d); break
		case 'in': case 'lds': {
			const resource = alias(i.name === 'in' ? k + 32 : k)
			if (resource !== undefined) read(resource)
			load(d)
			break
		}
		case 'out': case 'sts': {
			read(d)
			const resource = alias(i.name === 'out' ? k + 32 : k)
			if (resource !== undefined) { write(resource); if (resource === SP) read(SP) }
			break
		}
		case 'ld': case 'st': {
			const p = k >= 12 ? 26 : k >= 8 ? 28 : 30
			read(p, p + 1)
			if (i.name === 'ld') load(d)
			else read(d)
			if (![0, 8, 12].includes(k)) write(p, p + 1)
			// Indirect RAM accesses may alias register-file/SREG/SP addresses.
			// Exact alias selection depends on live pointer values, not this cached form.
			break
		}
		case 'lpm': read(30, 31); load(0); break
		case 'branch': read(SREG); break
		case 'cpse': read(d, i.r!); break
		case 'sbrc': case 'sbrs': read(d); break
		case 'rcall': case 'call': case 'ret': stack(); break
		case 'icall': stack(); read(30, 31); break
		case 'ijmp': read(30, 31); break
	}
	const isLoad = ['ld', 'lds', 'lpm', 'pop', 'in'].includes(i.name)
	const branch = ['branch', 'cpse', 'sbrc', 'sbrs'].includes(i.name)
	const jump = ['rjmp', 'rcall', 'jmp', 'call', 'ijmp', 'icall', 'ret'].includes(i.name)
	const info: InstructionInfo = {
		mnemonic: i.name, category: isLoad || ['st', 'sts', 'push', 'out'].includes(i.name) ? 3 : branch ? 2 : jump ? 1 : i.name === 'break' ? 5 : 0,
		encoding: 0, reads: [...reads], writes: [...writes], loadWrites: [...loaded], isLoad, isBranch: branch, isJump: jump,
	}
	cache.set(i, info)
	return info
}
