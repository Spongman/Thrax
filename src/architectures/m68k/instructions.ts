import type { InstructionInfo, InstructionSet } from '../contracts'
import type { M68kCpu } from './cpu'
import { decodeInstruction, type Decoded, type Operand } from './decode'
import type { M68kRecord } from './history'
import { REGISTER_NAMES } from './isa'

export const DEPENDENCY_NAMES = [...REGISTER_NAMES, 'CCR/SR']
const CCR = 16, SP = 15
const cache = new Map<number, InstructionInfo>()
const indexed = (ea?: Operand) => ea && (ea.mode === 6 || (ea.mode === 7 && ea.reg === 3)) ? ea.extension[0] >>> 12 : 0

export function describeM68kInstruction(d: Decoded): InstructionInfo {
	// Dependency identity excludes addresses and immediate data. No string or
	// metadata allocation on cache hits, including separately decoded repetitions.
	const key = d.words[0] + (d.mask ?? 0) * 65536 + (indexed(d.source) * 16 + indexed(d.destination)) * 0x1_0000_0000
	const cached = cache.get(key)
	if (cached) return cached
	const reads = new Set<number>(), writes = new Set<number>(), loaded = new Set<number>()
	const read = (...r: number[]) => { for (const n of r) reads.add(n) }
	const write = (...r: number[]) => { for (const n of r) writes.add(n) }
	const load = (r: number) => { write(r); loaded.add(r) }
	const name = d.name
	const addressOnly = ['lea', 'pea', 'jsr', 'jmp'].includes(name)
	const readOnly = ['cmp', 'cmpi', 'cmpa', 'tst', 'btst'].includes(name)
	const memory = (ea?: Operand) => !!ea && ea.mode >= 2 && !(ea.mode === 7 && ea.reg === 4)
	const effective = (ea?: Operand) => {
		if (!ea || ea.mode < 2) return
		if (ea.mode < 7) read(ea.reg + 8)
		if (ea.mode === 3 || ea.mode === 4) write(ea.reg + 8)
		if (ea.mode === 6 || (ea.mode === 7 && ea.reg === 3)) read(ea.extension[0] >>> 12)
	}
	const source = (ea?: Operand) => { effective(ea); if (ea && ea.mode < 2) read(ea.reg + (ea.mode === 1 ? 8 : 0)) }
	const destination = (ea?: Operand, fromMemory = false) => {
		effective(ea)
		if (!ea || ea.mode >= 2) return
		const r = ea.reg + (ea.mode === 1 ? 8 : 0)
		if (ea.mode === 0 && d.size < 4) read(r) // Upper Dn lanes survive narrow writes.
		if (fromMemory) load(r); else write(r)
	}
	const stack = () => { read(SP); write(SP) }
	let isLoad = !addressOnly && (memory(d.source) || (memory(d.destination) && !['move', 'movea', 'clr', 'scc', 'movesr', 'fromccr', 'movem'].includes(name)))
	if (d.condition !== undefined && d.condition >= 2) read(CCR)
	if (name === 'movem') {
		const ea = d.source ?? d.destination!
		effective(ea)
		for (let n = 0; n < 16; n++) if (d.mask! & (1 << n)) {
			const r = d.destination?.mode === 4 ? 15 - n : n
			if (d.source) load(r); else read(r)
		}
		if (d.source?.mode === 3) loaded.delete(d.source.reg + 8)
	} else if (name === 'exg') { read(d.reg!, d.value!); write(d.reg!, d.value!) }
	else if (name === 'link') { stack(); read(d.reg!); write(d.reg!) }
	else if (name === 'unlk') { read(d.reg!); write(SP); load(d.reg!); isLoad = true }
	else if (name === 'rts' || name === 'rtd') stack()
	else if (name === 'bsr') stack()
	else if (addressOnly) { effective(d.source); if (name === 'lea') write(d.reg!); if (name === 'pea' || name === 'jsr') stack() }
	else if (name === 'dbcc') { read(d.reg!); write(d.reg!) }
	else if (name === 'trap') { if (d.value === 15) { read(0, 1, 9); write(1) } }
	else if (name === 'moveq') write(d.reg!)
	else if (name === 'move' || name === 'movea') { source(d.source); destination(d.destination, memory(d.source)) }
	else if (name === 'moveccr') { source(d.source); write(CCR) }
	else if (name === 'movesr' || name === 'fromccr') { read(CCR); destination(d.destination) }
	else if (name.endsWith('ccr')) { read(CCR); write(CCR) }
	else if (name === 'scc') destination(d.destination)
	else if (!['nop', 'illegal', 'bkpt'].includes(name) && d.condition === undefined) {
		source(d.source)
		if (d.reg !== undefined) read(d.reg)
		if (d.destination) {
			if (name !== 'clr') source(d.destination)
			if (!readOnly) destination(d.destination)
		} else if (d.reg !== undefined && !readOnly) write(d.reg)
	}
	const changesFlags = ['move', 'moveq', 'swap', 'ext', 'extb', 'clr', 'neg', 'not', 'tst', 'cmp', 'cmpi', 'cmpa', 'btst', 'bchg', 'bclr', 'bset', 'add', 'addi', 'sub', 'subi', 'and', 'andi', 'or', 'ori', 'eor', 'eori', 'mulu', 'muls', 'divu', 'divs'].includes(name)
		|| /^(?:as|ls|ro|rox)[lr]$/.test(name) || (['addq', 'subq'].includes(name) && d.destination?.mode !== 1)
	if (changesFlags) { read(CCR); write(CCR) }
	if (isLoad && changesFlags) {
		loaded.add(CCR)
		if (!readOnly) {
			if (d.destination && d.destination.mode < 2) loaded.add(d.destination.reg + (d.destination.mode === 1 ? 8 : 0))
			else if (d.reg !== undefined) loaded.add(d.reg)
		}
	}
	const branch = name === 'dbcc' || (d.condition !== undefined && d.condition >= 2)
	const jump = ['jmp', 'jsr', 'rts', 'rtd', 'bra', 'bsr'].includes(name)
	const info: InstructionInfo = {
		mnemonic: name, category: branch ? 2 : jump ? 1 : isLoad || memory(d.destination) ? 3 : name === 'trap' || name === 'bkpt' ? 5 : 0,
		encoding: 0, reads: [...reads], writes: [...writes], loadWrites: [...loaded], isLoad, isBranch: branch, isJump: jump,
	}
	if (cache.size >= 4096) cache.clear()
	cache.set(key, info)
	return info
}

export function instructionSetFor(cpu: M68kCpu): InstructionSet {
	return {
		encodings: ['Integer'], registerNames: DEPENDENCY_NAMES,
		describe: instruction => describeM68kInstruction(instruction as Decoded),
		decodeExecuted(entry) {
			if (entry.kind === 'edit') return null
			const record = entry as M68kRecord
			try { return decodeInstruction(address => record.words[(address - record.address) / 2] ?? 0, record.address, cpu.model) }
			catch { return null }
		},
	}
}
