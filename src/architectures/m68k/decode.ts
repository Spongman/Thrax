import { CONDITIONS, sign, type EffectiveAddress } from './isa'
import type { CpuModel } from './settings'
import { CONTROL_IN, CONTROL_OUT, decodeFpu, disassembleFpu, type FpuFields } from './fpuIsa'

export interface Operand extends EffectiveAddress {
	extensionPc: number
}
export interface Decoded {
	name: string
	size: number
	address: number
	length: number
	words: number[]
	source?: Operand
	destination?: Operand
	reg?: number
	value?: number
	condition?: number
	mask?: number
	fpu?: FpuFields
}
/** `fpu` decodes coprocessor ID 1 F-line words for an attached MC68881/MC68882. */
export function decodeInstruction(readWord: (address: number) => number, address: number, model: CpuModel, fpu = false): Decoded {
	let pc = address
	const words: number[] = []
	const word = () => {
		const value = readWord(pc)
		words.push(value)
		pc += 2
		return value
	}
	const long = () => (word() * 65536 + word()) >>> 0
	const first = word(),
		mode = (first >> 3) & 7,
		register = first & 7,
		sizeBits = (first >> 6) & 3
	const d: Decoded = { name: '', size: sizeBits === 0 ? 1 : sizeBits === 1 ? 2 : 4, address, length: 2, words }
	const ea = (mode: number, reg: number, size: number): Operand => {
		const extensionPc = pc,
			extension: number[] = []
		const add = () => {
			const value = word()
			extension.push(value)
			return value
		}
		if (mode === 5 || mode === 6 || (mode === 7 && [0, 2, 3].includes(reg))) add()
		else if (mode === 7 && reg === 1) {
			add()
			add()
		} else if (mode === 7 && reg === 4) {
			// Bytes and words take one word; wider FPU immediates take size / 2.
			for (let i = 0; i < Math.max(1, size / 2); i++) add()
		} else if (mode === 7 && reg > 4) throw new Error('Illegal effective address')
		if (
			(mode === 6 || (mode === 7 && reg === 3)) &&
			(extension[0] & 0x100 || (model !== '68020' && extension[0] & 0x600))
		)
			throw new Error('Unsupported index extension for selected model')
		return { mode, reg, extension, extensionPc }
	}
	const src = () => (d.source = ea(mode, register, d.size))
	const dst = () => (d.destination = ea(mode, register, d.size))
	const top = first >>> 12
	if ([1, 2, 3].includes(top)) {
		d.size = top === 1 ? 1 : top === 2 ? 4 : 2
		d.name = ((first >> 6) & 7) === 1 ? 'movea' : 'move'
		src()
		d.destination = ea((first >> 6) & 7, (first >> 9) & 7, d.size)
	} else if ((first & 0xf100) === 0x7000) {
		d.name = 'moveq'
		d.reg = (first >> 9) & 7
		d.value = sign(first, 1)
		d.size = 4
	} else if (top === 6) {
		d.condition = (first >> 8) & 15
		d.name = d.condition === 0 ? 'bra' : d.condition === 1 ? 'bsr' : `b${CONDITIONS[d.condition]}`
		const low = first & 255
		d.value = low === 0 ? sign(word(), 2) : low === 255 && model === '68020' ? long() | 0 : sign(low, 1)
	} else if ((first & 0xf0f8) === 0x50c8) {
		d.name = 'dbcc'
		d.condition = (first >> 8) & 15
		d.reg = register
		d.value = sign(word(), 2)
		d.size = 2
	} else if ((first & 0xf0c0) === 0x50c0) {
		d.name = 'scc'
		d.condition = (first >> 8) & 15
		d.size = 1
		dst()
	} else if (top === 5) {
		d.name = first & 0x100 ? 'subq' : 'addq'
		d.value = (first >> 9) & 7 || 8
		dst()
	} else if (first === 0x4e71) d.name = 'nop'
	else if (first === 0x4e75) d.name = 'rts'
	else if (first === 0x4afc) d.name = 'illegal'
	else if (first === 0x4e74 && model !== '68000') {
		d.name = 'rtd'
		d.value = sign(word(), 2)
	} else if ((first & 0xfff8) === 0x4e50) {
		d.name = 'link'
		d.reg = register + 8
		d.value = sign(word(), 2)
	} else if ((first & 0xfff8) === 0x4e58) {
		d.name = 'unlk'
		d.reg = register + 8
	} else if ((first & 0xfff0) === 0x4e40) {
		d.name = 'trap'
		d.value = first & 15
	} else if ((first & 0xfff8) === 0x4848 && model !== '68000') {
		d.name = 'bkpt'
		d.value = register
	} else if ((first & 0xfff8) === 0x4840) {
		d.name = 'swap'
		d.reg = register
		d.size = 4
	} else if (
		(first & 0xfff8) === 0x4880 ||
		(first & 0xfff8) === 0x48c0 ||
		((first & 0xfff8) === 0x49c0 && model === '68020')
	) {
		d.name = (first & 0xfff8) === 0x49c0 ? 'extb' : 'ext'
		d.reg = register
		d.size = first & 0x40 ? 4 : 2
	} else if ((first & 0xfb80) === 0x4880) {
		d.name = 'movem'
		d.size = first & 0x40 ? 4 : 2
		d.mask = word()
		if (first & 0x400) src()
		else dst()
	} else if ((first & 0xf1c0) === 0x41c0) {
		d.name = 'lea'
		d.size = 4
		d.reg = ((first >> 9) & 7) + 8
		src()
	} else if ((first & 0xffc0) === 0x4840 || (first & 0xffc0) === 0x4e80 || (first & 0xffc0) === 0x4ec0) {
		d.name = (first & 0xffc0) === 0x4840 ? 'pea' : first & 0x40 ? 'jmp' : 'jsr'
		d.size = 4
		src()
	} else if ([0x40c0, 0x42c0, 0x44c0].includes(first & 0xffc0)) {
		d.size = 2
		if ((first & 0xffc0) === 0x44c0) {
			d.name = 'moveccr'
			src()
		} else {
			d.name = (first & 0xffc0) === 0x40c0 ? 'movesr' : 'fromccr'
			if (d.name === 'fromccr' && model === '68000') throw new Error('MOVE from CCR requires MC68010')
			dst()
		}
	} else if ([0x4200, 0x4400, 0x4600, 0x4a00].includes(first & 0xff00) && sizeBits !== 3) {
		d.name = ({ 0x4200: 'clr', 0x4400: 'neg', 0x4600: 'not', 0x4a00: 'tst' } as Record<number, string>)[first & 0xff00]
		dst()
	} else if (top === 0 && ((first & 0xf100) === 0x0100 || (first & 0xff00) === 0x0800)) {
		d.name = ['btst', 'bchg', 'bclr', 'bset'][(first >> 6) & 3]
		d.size = mode === 0 ? 4 : 1
		if (first & 0x100) d.reg = (first >> 9) & 7
		else d.value = word()
		dst()
	} else if (top === 0 && [0, 2, 4, 6, 10, 12].includes((first >> 8) & 15)) {
		d.name = ({ 0: 'ori', 2: 'andi', 4: 'subi', 6: 'addi', 10: 'eori', 12: 'cmpi' } as Record<number, string>)[
			(first >> 8) & 15
		]
		if ((first & 255) === 0x3c && ['ori', 'andi', 'eori'].includes(d.name)) {
			d.name += 'ccr'
			d.value = word()
			d.size = 1
		} else {
			if (sizeBits === 3) throw new Error('Illegal immediate size')
			d.value = d.size === 4 ? long() : word()
			dst()
		}
	} else if ((first & 0xf1f8) === 0xc140 || (first & 0xf1f8) === 0xc148 || (first & 0xf1f8) === 0xc188) {
		d.name = 'exg'
		d.reg = ((first >> 9) & 7) + ((first & 0xf1f8) === 0xc148 ? 8 : 0)
		d.value = register + ((first & 0xf1f8) === 0xc140 ? 0 : 8)
	} else if ((top === 8 || top === 12) && sizeBits === 3) {
		d.name = `${top === 8 ? 'div' : 'mul'}${first & 0x100 ? 's' : 'u'}`
		d.size = 2
		d.reg = (first >> 9) & 7
		src()
	} else if ([8, 9, 11, 12, 13].includes(top)) {
		const opmode = (first >> 6) & 7
		d.reg = (first >> 9) & 7
		if (opmode === 3 || opmode === 7) {
			if (![9, 11, 13].includes(top)) throw new Error('Illegal opcode')
			d.name = top === 9 ? 'suba' : top === 11 ? 'cmpa' : 'adda'
			d.size = opmode === 3 ? 2 : 4
			d.reg += 8
			src()
		} else {
			d.name =
				top === 8 ? 'or' : top === 9 ? 'sub' : top === 11 ? (opmode < 4 ? 'cmp' : 'eor') : top === 12 ? 'and' : 'add'
			if (opmode < 4) src()
			else dst()
		}
	} else if (top === 15) {
		if (!fpu || ((first >> 9) & 7) !== 1) throw new Error(`F-line opcode $${first.toString(16)} needs an MC68881/MC68882 coprocessor`)
		decodeFpu(first, d, word, ea)
	} else if (top === 14 && sizeBits !== 3) {
		const type = (first >> 3) & 3
		d.name = `${['as', 'ls', 'rox', 'ro'][type]}${first & 0x100 ? 'l' : 'r'}`
		d.reg = register
		if (first & 0x20) d.source = { mode: 0, reg: (first >> 9) & 7, extension: [], extensionPc: pc }
		else d.value = (first >> 9) & 7 || 8
	}
	// Reject overlapping encodings for excluded instructions (ADDX/SUBX,
	// ABCD/SBCD, CMPM) rather than treating them as ordinary arithmetic.
	if (
		d.source &&
		['lea', 'pea', 'jmp', 'jsr'].includes(d.name) &&
		(![2, 5, 6, 7].includes(d.source.mode) || (d.source.mode === 7 && d.source.reg > 3))
	)
		throw new Error('Illegal control effective address')
	if (d.name === 'movea' && d.size === 1) throw new Error('MOVEA cannot use byte operands')
	if (d.name === 'movem') {
		const ea = d.source ?? d.destination!
		if (
			d.source
				? ![2, 3, 5, 6, 7].includes(ea.mode) || (ea.mode === 7 && ea.reg > 3)
				: ![2, 4, 5, 6, 7].includes(ea.mode) || (ea.mode === 7 && ea.reg > 1)
		)
			throw new Error('Illegal MOVEM effective address')
	}
	if (d.destination) {
		const destination = d.destination
		if (destination.mode === 7 && destination.reg >= 2) throw new Error('Illegal destination effective address')
		if (destination.mode === 1 && !['movea', 'addq', 'subq'].includes(d.name) && d.fpu?.kind !== CONTROL_OUT)
			throw new Error('Illegal address-register destination')
		if (destination.mode < 2 && ['add', 'sub', 'or', 'and'].includes(d.name))
			throw new Error('Unsupported extended/decimal arithmetic encoding')
	}
	if (d.source?.mode === 1 && !['move', 'movea', 'adda', 'suba', 'cmpa'].includes(d.name) && d.fpu?.kind !== CONTROL_IN)
		throw new Error('Illegal address-register source')
	if (!d.name) throw new Error(`Unsupported/illegal MC${model} opcode $${first.toString(16).padStart(4, '0')}`)
	d.length = pc - address
	return d
}
export function operandText(ea: Operand): string {
	const register = `a${ea.reg}`,
		extension = ea.extension,
		value = () => (extension[0] * 65536 + extension[1]) >>> 0
	if (ea.mode === 0) return `d${ea.reg}`
	if (ea.mode === 1) return register
	if (ea.mode === 2) return `(${register})`
	if (ea.mode === 3) return `(${register})+`
	if (ea.mode === 4) return `-(${register})`
	if (ea.mode === 5 || (ea.mode === 7 && ea.reg === 2))
		return `${sign(extension[0], 2)}(${ea.mode === 7 ? 'pc' : register})`
	if (ea.mode === 6 || (ea.mode === 7 && ea.reg === 3)) {
		const ext = extension[0],
			index = ext >>> 12
		return `${sign(ext, 1)}(${ea.mode === 7 ? 'pc' : register},${index > 7 ? 'a' : 'd'}${index & 7}.${ext & 0x800 ? 'l' : 'w'}*${1 << ((ext >> 9) & 3)})`
	}
	if (ea.reg === 4) return `#$${(extension.length === 2 ? value() : extension[0]).toString(16)}`
	return `$${(extension.length === 2 ? value() : sign(extension[0], 2) >>> 0).toString(16)}${ea.reg === 0 ? '.w' : '.l'}`
}
export function disassemble(d: Decoded): string {
	const suffix = d.size === 1 ? '.b' : d.size === 2 ? '.w' : '.l',
		r = (n: number) => `${n < 8 ? 'd' : 'a'}${n & 7}`
	if (d.fpu) return disassembleFpu(d, operandText)
	if (d.name.startsWith('b') && d.condition !== undefined)
		return `${d.name} $${((d.address + 2 + d.value!) >>> 0).toString(16)}`
	if (d.name === 'dbcc')
		return `db${CONDITIONS[d.condition!]} d${d.reg},$${((d.address + 2 + d.value!) >>> 0).toString(16)}`
	if (d.name === 'scc') return `s${CONDITIONS[d.condition!]} ${operandText(d.destination!)}`
	if (d.name === 'movem')
		return `movem${suffix} ${d.source ? `${operandText(d.source)},$${d.mask!.toString(16)}` : `$${d.mask!.toString(16)},${operandText(d.destination!)}`}`
	if (d.name === 'exg') return `exg ${r(d.reg!)},${r(d.value!)}`
	if (d.name === 'link') return `link.w ${r(d.reg!)},#${d.value}`
	if (d.name === 'moveccr') return `move.w ${operandText(d.source!)},ccr`
	if (d.name === 'movesr' || d.name === 'fromccr')
		return `move.w ${d.name === 'movesr' ? 'sr' : 'ccr'},${operandText(d.destination!)}`
	if (d.name.endsWith('ccr')) return `${d.name.slice(0, -3)} #$${d.value!.toString(16)},ccr`
	if (d.source && d.destination) return `${d.name}${suffix} ${operandText(d.source)},${operandText(d.destination)}`
	if (d.source) return `${d.name}${suffix} ${operandText(d.source)}${d.reg !== undefined ? `,${r(d.reg)}` : ''}`
	if (d.destination)
		return `${d.name}${suffix} ${d.value !== undefined ? `#${d.value},` : d.reg !== undefined ? `${r(d.reg)},` : ''}${operandText(d.destination)}`
	if (d.reg !== undefined && d.value !== undefined) return `${d.name}${suffix} #${d.value},${r(d.reg)}`
	if (d.reg !== undefined) return `${d.name}${suffix} ${r(d.reg)}`
	if (d.value !== undefined) return `${d.name} #${d.value}`
	return d.name
}
