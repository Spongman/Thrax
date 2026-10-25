import type { CpuModel } from './settings'
import {
	addressRegister,
	conditionCode,
	dataRegister,
	longWords,
	requireModel,
	sizeCode,
	type EffectiveAddress
} from './isa'
import { encodeFpu } from './fpuEncoding'

export interface EncodingContext {
	pc: number
	emitting: boolean
	model: CpuModel
	/** An MC68881/MC68882 is attached. */
	fpu?: boolean
	value(text: string): number
}
function range(value: number, low: number, high: number, context: EncodingContext, what: string) {
	if (context.emitting && (!Number.isInteger(value) || value < low || value > high))
		throw new Error(`${what} out of range (${value})`)
	return value
}
const eaBits = (ea: EffectiveAddress) => ea.mode * 8 + ea.reg
function alterable(ea: EffectiveAddress, memoryOnly = false) {
	if (ea.mode === 1 || (ea.mode === 7 && ea.reg >= 2) || (memoryOnly && ea.mode === 0))
		throw new Error('Expected alterable effective address')
}
function control(ea: EffectiveAddress) {
	if (![2, 5, 6, 7].includes(ea.mode) || (ea.mode === 7 && ea.reg > 3))
		throw new Error('Expected control addressing mode')
}
/** The brief extension format; full extension/memory indirect formats are excluded. */
export function encodeEA(text: string, size: number, c: EncodingContext, extensionPc: number): EffectiveAddress {
	text = text
		.trim()
		.replace(/\b(?:d[0-7]|a[0-7]|sp|pc)\b/gi, (register) => register.toLowerCase())
		.replace(/(\b[da][0-7])\.([wl])/gi, (index) => index.toLowerCase())
		.replace(/,\s+/g, ',')
	if (/^d[0-7]$/.test(text)) return { mode: 0, reg: dataRegister(text), extension: [] }
	if (/^(?:a[0-7]|sp)$/.test(text)) {
		if (size === 1) throw new Error('Address registers cannot be byte operands')
		return { mode: 1, reg: addressRegister(text), extension: [] }
	}
	if (text.startsWith('#')) {
		const value = c.value(text.slice(1))
		range(
			value,
			size === 4 ? -0x80000000 : -(2 ** (size * 8 - 1)),
			size === 4 ? 0xffffffff : 2 ** (size * 8) - 1,
			c,
			'Immediate'
		)
		return { mode: 7, reg: 4, extension: size === 4 ? longWords(value) : [value & (size === 1 ? 255 : 65535)] }
	}
	let match = /^\((a[0-7]|sp)\)(\+)?$/.exec(text)
	if (match) return { mode: match[2] ? 3 : 2, reg: addressRegister(match[1]), extension: [] }
	match = /^-\((a[0-7]|sp)\)$/.exec(text)
	if (match) return { mode: 4, reg: addressRegister(match[1]), extension: [] }
	// Accept both disp(An,Xn) and (disp,An,Xn).
	if (/^\([^()]+,[^()]+\)$/.test(text)) {
		const parts = text.slice(1, -1).split(',')
		if (!/^(?:a[0-7]|sp|pc)$/i.test(parts[0])) text = `${parts.shift()}(${parts.join(',')})`
	}
	match = /^(.*?)\((a[0-7]|sp|pc)(?:,([da][0-7])(?:\.(w|l))?(?:\*([1248]))?)?\)$/.exec(text)
	if (match) {
		const pc = match[2] === 'pc'
		let displacement = c.value(match[1] || '0')
		if (pc && /[a-z_]/i.test((match[1] || '').replace(/\$[\da-f]+|0x[\da-f]+/gi, ''))) displacement -= extensionPc
		if (!match[3]) {
			range(displacement, -32768, 32767, c, 'Displacement')
			return { mode: pc ? 7 : 5, reg: pc ? 2 : addressRegister(match[2]), extension: [displacement & 65535] }
		}
		const scale = Number(match[5] || 1)
		if (scale !== 1) requireModel(c.model, '68020', 'Scaled indexing')
		range(displacement, -128, 127, c, 'Brief index displacement')
		const index = Number(match[3][1]) + (match[3][0] === 'a' ? 8 : 0)
		return {
			mode: pc ? 7 : 6,
			reg: pc ? 3 : addressRegister(match[2]),
			extension: [(index << 12) | (match[4] === 'l' ? 0x800 : 0) | (Math.log2(scale) << 9) | (displacement & 255)]
		}
	}
	match = /^(.*?)\.(w|l)$/i.exec(text)
	if (match && match[2].toLowerCase() === 'w') {
		const value = range(c.value(match[1]), -32768, 65535, c, 'Absolute short address')
		return { mode: 7, reg: 0, extension: [value & 65535] }
	}
	const value = range(c.value(match ? match[1] : text), -0x80000000, 0xffffffff, c, 'Address')
	return { mode: 7, reg: 1, extension: longWords(value) }
}
function registerList(text: string): number {
	let mask = 0
	for (const part of text.toLowerCase().split('/')) {
		const ends = part.split('-'),
			index = (name: string) => (/^d/.test(name) ? dataRegister(name) : addressRegister(name) + 8)
		const from = index(ends[0]),
			to = index(ends[1] ?? ends[0])
		if (to < from || from < 8 !== to < 8) throw new Error('Invalid register range')
		for (let r = from; r <= to; r++) mask |= 1 << r
	}
	return mask
}
export function encodeInstruction(operation: string, args: string[], c: EncodingContext): number[] {
	const fpu = encodeFpu(operation, args, c)
	if (fpu) return fpu
	const split = operation.toLowerCase().split('.'),
		name = split[0],
		suffix = split[1],
		size = suffix === 'b' || suffix === 's' ? 1 : suffix === 'l' ? 4 : 2
	if (split.length > 2 || (suffix && !['b', 's', 'w', 'l'].includes(suffix)))
		throw new Error('Invalid instruction size')
	if (suffix === 's' && !/^b(?:ra|sr|hi|ls|cc|cs|hs|lo|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)$/.test(name))
		throw new Error('.S is only a short-branch suffix')
	if (suffix && ['nop', 'rts', 'illegal', 'unlk', 'rtd', 'bkpt', 'trap', 'moveq', 'exg'].includes(name))
		throw new Error(`${name} is unsized`)
	if (suffix && ['lea', 'pea', 'jmp', 'jsr'].includes(name) && suffix !== 'l')
		throw new Error(`${name} requires a long address`)
	if (suffix && name.startsWith('db') && suffix !== 'w') throw new Error('DBcc has a word displacement')
	const need = (count: number) => {
		if (args.length !== count) throw new Error(`${name} expects ${count} operands`)
	}
	const ea = (i: number, bytes = size, pc = c.pc + 2) => encodeEA(args[i], bytes, c, pc)
	const immediate = (i: number) => {
		if (!args[i]?.startsWith('#')) throw new Error('Expected #immediate')
		return c.value(args[i].slice(1))
	}
	const one = (opcode: number, operand: EffectiveAddress) => [opcode | eaBits(operand), ...operand.extension]
	if (['nop', 'rts', 'illegal', 'unlk', 'rtd', 'bkpt', 'trap', 'link'].includes(name)) {
		if (name === 'nop' || name === 'rts' || name === 'illegal') {
			need(0)
			return [name === 'nop' ? 0x4e71 : name === 'rts' ? 0x4e75 : 0x4afc]
		}
		if (name === 'unlk') {
			need(1)
			return [0x4e58 | addressRegister(args[0])]
		}
		if (name === 'link') {
			need(2)
			if (size !== 2) throw new Error('Only LINK.W is supported')
			return [0x4e50 | addressRegister(args[0]), range(immediate(1), -32768, 32767, c, 'LINK displacement') & 65535]
		}
		if (name === 'rtd') {
			need(1)
			requireModel(c.model, '68010', name)
			return [0x4e74, range(immediate(0), -32768, 32767, c, 'RTD displacement') & 65535]
		}
		if (name === 'bkpt') {
			need(1)
			requireModel(c.model, '68010', name)
			return [0x4848 | range(immediate(0), 0, 7, c, 'Breakpoint number')]
		}
		need(1)
		return [0x4e40 | range(immediate(0), 0, 15, c, 'Trap number')]
	}
	if (name === 'moveq') {
		need(2)
		return [0x7000 | (dataRegister(args[1]) << 9) | (range(immediate(0), -128, 127, c, 'MOVEQ immediate') & 255)]
	}
	if (name === 'move' || name === 'movea') {
		need(2)
		if (suffix && /^(?:ccr|sr)$/i.test(args[0]) && suffix !== 'w') throw new Error('SR/CCR transfers use word size')
		if (suffix && /^(?:ccr|sr)$/i.test(args[1]) && suffix !== 'w') throw new Error('SR/CCR transfers use word size')
		if (/^(ccr|sr)$/i.test(args[1])) {
			if (args[1].toLowerCase() === 'sr') throw new Error('Privileged MOVE to SR is outside this profile')
			return one(0x44c0, ea(0, 2))
		}
		if (/^(ccr|sr)$/i.test(args[0])) {
			if (args[0].toLowerCase() === 'ccr') requireModel(c.model, '68010', 'MOVE from CCR')
			const destination = ea(1, 2)
			alterable(destination)
			return one(args[0].toLowerCase() === 'sr' ? 0x40c0 : 0x42c0, destination)
		}
		const source = ea(0),
			destination = ea(1, size, c.pc + 2 + source.extension.length * 2)
		if (destination.mode !== 1) alterable(destination)
		if (name === 'movea' && destination.mode !== 1) throw new Error('MOVEA requires address-register destination')
		return [
			(size === 1 ? 0x1000 : size === 2 ? 0x3000 : 0x2000) |
				(destination.reg << 9) |
				(destination.mode << 6) |
				eaBits(source),
			...source.extension,
			...destination.extension
		]
	}
	if (name === 'lea' || name === 'pea' || name === 'jmp' || name === 'jsr') {
		need(name === 'lea' ? 2 : 1)
		const source = ea(0, 4)
		control(source)
		return one(
			name === 'lea'
				? 0x41c0 | (addressRegister(args[1]) << 9)
				: name === 'pea'
					? 0x4840
					: name === 'jmp'
						? 0x4ec0
						: 0x4e80,
			source
		)
	}
	if (name === 'movem') {
		need(2)
		if (size === 1) throw new Error('MOVEM supports word or long')
		const toMemory = /^(?:[da][0-7]|sp)(?:[/-]|$)/i.test(args[0]),
			registers = registerList(args[toMemory ? 0 : 1]),
			address = ea(toMemory ? 1 : 0, size, c.pc + 4)
		if (toMemory) {
			if (![2, 4, 5, 6, 7].includes(address.mode) || (address.mode === 7 && address.reg > 1))
				throw new Error('Invalid MOVEM store mode')
		} else if (![2, 3, 5, 6, 7].includes(address.mode) || (address.mode === 7 && address.reg > 3))
			throw new Error('Invalid MOVEM load mode')
		let bits = registers
		if (toMemory && address.mode === 4) {
			bits = 0
			for (let i = 0; i < 16; i++) if (registers & (1 << i)) bits |= 1 << (15 - i)
		}
		return [0x4880 | (toMemory ? 0 : 0x400) | (size === 4 ? 0x40 : 0) | eaBits(address), bits, ...address.extension]
	}
	if (name === 'swap' || name === 'ext' || name === 'extb') {
		need(1)
		const reg = dataRegister(args[0])
		if (name === 'extb') {
			requireModel(c.model, '68020', name)
			if (size !== 4) throw new Error('EXTB requires .L')
			return [0x49c0 | reg]
		}
		if (name === 'swap') {
			if (suffix && suffix !== 'w') throw new Error('SWAP is unsized or .W')
			return [0x4840 | reg]
		}
		if (size === 1) throw new Error('EXT requires .W or .L')
		return [(size === 4 ? 0x48c0 : 0x4880) | reg]
	}
	if (name === 'exg') {
		need(2)
		const a = ea(0, 4),
			b = ea(1, 4)
		if (a.mode > 1 || b.mode > 1) throw new Error('EXG requires registers')
		if (a.mode === 1 && b.mode === 0) return [0xc188 | (b.reg << 9) | a.reg]
		return [(a.mode === b.mode ? (a.mode === 0 ? 0xc140 : 0xc148) : 0xc188) | (a.reg << 9) | b.reg]
	}
	if (name.startsWith('db')) {
		need(2)
		const cc = name === 'dbra' ? 1 : conditionCode(name.slice(2))
		return [
			0x50c8 | (cc << 8) | dataRegister(args[0]),
			range(c.value(args[1]) - (c.pc + 2), -32768, 32767, c, 'DBcc displacement') & 65535
		]
	}
	if (name === 'bra' || name === 'bsr' || /^b(?:hi|ls|cc|cs|hs|lo|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)$/.test(name)) {
		need(1)
		const cc = name === 'bra' ? 0 : name === 'bsr' ? 1 : conditionCode(name.slice(1)),
			offset = c.value(args[0]) - (c.pc + 2),
			opcode = 0x6000 | (cc << 8)
		if (size === 1) {
			range(offset, -128, 127, c, 'Byte branch')
			if (c.emitting && (offset === 0 || (c.model === '68020' && offset === -1)))
				throw new Error('Reserved short branch displacement')
			return [opcode | (offset & 255)]
		}
		if (size === 4) {
			requireModel(c.model, '68020', 'Long branch')
			range(offset, -0x80000000, 0x7fffffff, c, 'Long branch')
			return [opcode | 255, ...longWords(offset)]
		}
		return [opcode, range(offset, -32768, 32767, c, 'Word branch') & 65535]
	}
	if (/^s(?:t|f|hi|ls|cc|cs|hs|lo|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)$/.test(name)) {
		if (suffix && suffix !== 'b') throw new Error('Scc writes one byte')
		need(1)
		const destination = ea(0, 1)
		alterable(destination)
		return one(0x50c0 | (conditionCode(name.slice(1)) << 8), destination)
	}
	if (['clr', 'tst', 'neg', 'not'].includes(name)) {
		need(1)
		const destination = ea(0)
		alterable(destination)
		return one({ clr: 0x4200, tst: 0x4a00, neg: 0x4400, not: 0x4600 }[name]! | (sizeCode(size) << 6), destination)
	}
	if (['addq', 'subq'].includes(name)) {
		need(2)
		const amount = range(immediate(0), 1, 8, c, 'Quick immediate'),
			destination = ea(1)
		if (destination.mode !== 1) alterable(destination)
		return one(0x5000 | (name === 'subq' ? 0x100 : 0) | ((amount & 7) << 9) | (sizeCode(size) << 6), destination)
	}
	if (['addi', 'subi', 'cmpi', 'andi', 'ori', 'eori'].includes(name)) {
		need(2)
		const value = immediate(0),
			opcode = { ori: 0, andi: 0x200, subi: 0x400, addi: 0x600, eori: 0xa00, cmpi: 0xc00 }[name]!
		if (args[1].toLowerCase() === 'ccr' && ['andi', 'ori', 'eori'].includes(name))
			return [opcode | 0x3c, range(value, 0, 255, c, 'CCR immediate')]
		const source = ea(0),
			destination = ea(1, size, c.pc + 2 + source.extension.length * 2)
		alterable(destination)
		return [opcode | (sizeCode(size) << 6) | eaBits(destination), ...source.extension, ...destination.extension]
	}
	if (['adda', 'suba', 'cmpa'].includes(name)) {
		need(2)
		if (size === 1) throw new Error('Address arithmetic requires .W/.L')
		return one(
			{ adda: 0xd000, suba: 0x9000, cmpa: 0xb000 }[name]! |
				(addressRegister(args[1]) << 9) |
				((size === 4 ? 7 : 3) << 6),
			ea(0)
		)
	}
	if (['add', 'sub', 'cmp', 'and', 'or', 'eor'].includes(name)) {
		need(2)
		const base = { add: 0xd000, sub: 0x9000, cmp: 0xb000, and: 0xc000, or: 0x8000, eor: 0xb000 }[name]!
		if (/^d[0-7]$/i.test(args[1]) && name !== 'eor') {
			const source = ea(0)
			if (source.mode === 1) throw new Error('Use address arithmetic for address registers')
			return one(base | (dataRegister(args[1]) << 9) | (sizeCode(size) << 6), source)
		}
		if (name === 'cmp') throw new Error('CMP requires data-register destination')
		const destination = ea(1)
		alterable(destination, name !== 'eor')
		return one(base | (dataRegister(args[0]) << 9) | 0x100 | (sizeCode(size) << 6), destination)
	}
	if (['muls', 'mulu', 'divs', 'divu'].includes(name)) {
		need(2)
		if (size !== 2) throw new Error('This profile supports word multiply/divide sources only')
		const source = ea(0, 2)
		if (source.mode === 1) throw new Error('Invalid source mode')
		return one(
			(name.startsWith('mul') ? 0xc0c0 : 0x80c0) | (name.endsWith('s') ? 0x100 : 0) | (dataRegister(args[1]) << 9),
			source
		)
	}
	if (['btst', 'bchg', 'bclr', 'bset'].includes(name)) {
		need(2)
		if (suffix && suffix !== (/^d[0-7]$/i.test(args[1]) ? 'l' : 'b'))
			throw new Error('Bit operations use .L for data registers and .B for memory')
		const immediateBit = args[0].startsWith('#'),
			destination = ea(1, /^d/i.test(args[1]) ? 4 : 1, c.pc + (immediateBit ? 4 : 2))
		alterable(destination)
		const op = ['btst', 'bchg', 'bclr', 'bset'].indexOf(name)
		return [
			(immediateBit ? 0x800 : 0x100 | (dataRegister(args[0]) << 9)) | (op << 6) | eaBits(destination),
			...(immediateBit ? [range(immediate(0), 0, 255, c, 'Bit number')] : []),
			...destination.extension
		]
	}
	if (['asl', 'asr', 'lsl', 'lsr', 'rol', 'ror', 'roxl', 'roxr'].includes(name)) {
		need(2)
		const fromRegister = !args[0].startsWith('#'),
			count = fromRegister ? dataRegister(args[0]) : range(immediate(0), 1, 8, c, 'Shift count'),
			type = name.startsWith('as') ? 0 : name.startsWith('ls') ? 1 : name.startsWith('rox') ? 2 : 3
		return [
			0xe000 |
				((count & 7) << 9) |
				(name.endsWith('l') ? 0x100 : 0) |
				(sizeCode(size) << 6) |
				(fromRegister ? 0x20 : 0) |
				(type << 3) |
				dataRegister(args[1])
		]
	}
	throw new Error(`Unsupported instruction '${operation}' in the integer teaching profile`)
}
