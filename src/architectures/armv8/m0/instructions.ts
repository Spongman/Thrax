import type { InstructionInfo } from '../../contracts'
import type { Instruction } from './isa'

export const REGISTER_IDS = [...Array.from({ length: 15 }, (_, n) => `R${n}`), 'PC', 'APSR', 'MSP', 'PSP', 'CONTROL', 'PRIMASK', 'EVENT']
const cache = new WeakMap<Instruction, InstructionInfo>()
const special = (n: number) => n <= 3 ? 16 : n === 8 ? 17 : n === 9 ? 18 : n === 16 ? 20 : n === 20 ? 19 : undefined

export function describe(i: Instruction): InstructionInfo {
	const cached = cache.get(i)
	if (cached) return cached
	const reads = new Set<number>(), writes = new Set<number>(), loaded = new Set<number>()
	const read = (...r: number[]) => { for (const n of r) reads.add(n) }
	const write = (...r: number[]) => { for (const n of r) writes.add(n) }
	const load = (r: number) => { write(r); loaded.add(r) }
	const isLoad = i.name.startsWith('ldr') || i.name === 'ldmia' || i.name === 'pop'
	const store = i.name.startsWith('str') || i.name === 'stmia' || i.name === 'push'
	const test = ['cmp', 'cmn', 'tst'].includes(i.name)
	if (['shift', 'rrr', 'imm3', 'address', 'sp'].includes(i.format)) { read(i.n); if (i.format === 'rrr') read(i.m); write(i.d) }
	else if (i.format === 'imm8') { if (i.name !== 'movs') read(i.n); if (!test) write(i.d) }
	else if (i.format === 'alu' || i.format === 'high') {
		read(i.m)
		if (!['mov', 'mvns', 'rsbs'].includes(i.name)) read(i.n)
		if (!test) write(i.d)
	} else if (i.format === 'unary') { read(i.m); write(i.d) }
	else if (['literal', 'memimm', 'memreg'].includes(i.format)) {
		read(i.n)
		if (i.format === 'memreg') read(i.m)
		if (isLoad) load(i.d)
		else read(i.d)
	} else if (i.format === 'list' || i.format === 'multiple') {
		const base = i.format === 'list' ? 13 : i.n
		read(base)
		for (let n = 0; n < 16; n++) if (i.list & (1 << n)) { if (isLoad) load(n); else read(n) }
		if (i.format === 'list' || !isLoad || !(i.list & (1 << base))) write(base)
	} else if (i.format === 'exchange') { read(i.m); if (i.name === 'blx') write(14) }
	else if (i.name === 'bl') write(14)
	else if (i.format === 'conditional') read(16)
	else if (i.name === 'mrs' || i.name === 'msr') {
		const resource = special(i.imm)
		if (i.name === 'mrs') { if (resource !== undefined) read(resource); write(i.d) }
		else { read(i.m); if (resource !== undefined) write(resource) }
	} else if (i.name === 'cpsid' || i.name === 'cpsie') write(20)
	else if (i.name === 'wfe') { read(21); write(21) }
	else if (i.name === 'sev') write(21)
	else if (i.name === 'svc') { if ([1, 4, 11].includes(i.imm)) read(0); if (i.imm === 5) write(0) }
	if (test || (i.name.endsWith('s') && ['alu', 'shift', 'rrr', 'imm3', 'imm8'].includes(i.format))) {
		read(16) // Partial updates preserve flags; ADC/SBC and shifts also consume carry.
		write(16)
	}
	// The selected stack bank aliases R13. Static metadata conservatively names
	// both possible banks; CONTROL selects the live one in the CPU.
	if (reads.has(13)) read(17, 18, 19)
	if (writes.has(13)) { read(19); write(17, 18) }
	if (i.name === 'msr' && [8, 9, 20].includes(i.imm)) {
		read(19); write(13)
		if (i.imm === 20) { read(13, 17, 18); write(17, 18) }
	}
	if (i.name === 'msr' && i.imm <= 3) read(16)
	const jump = ['b', 'bl', 'bx', 'blx'].includes(i.name) || writes.has(15)
	const info: InstructionInfo = {
		mnemonic: i.name, category: isLoad || store ? 3 : i.format === 'conditional' ? 2 : jump ? 1 : i.format === 'trap' ? 5 : 0,
		encoding: i.size === 4 ? 1 : 0, reads: [...reads], writes: [...writes], loadWrites: [...loaded],
		isLoad, isBranch: i.format === 'conditional', isJump: jump,
	}
	cache.set(i, info)
	return info
}
