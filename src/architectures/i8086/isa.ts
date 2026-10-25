import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'
import { decode8087, encode8087, wait8087, type Coprocessor } from './fpu'

export const names = ['AX', 'CX', 'DX', 'BX', 'SP', 'BP', 'SI', 'DI', 'ES', 'CS', 'SS', 'DS', 'IP', 'FLAGS'] as const
const words = names.slice(0, 8)
const bytes = ['AL', 'CL', 'DL', 'BL', 'AH', 'CH', 'DH', 'BH']
const segments = ['ES', 'CS', 'SS', 'DS']
const CF = 1, PF = 4, AF = 16, ZF = 64, SF = 128, DF = 1024, OF = 2048
const aluNames = ['ADD', 'OR', 'ADC', 'SBB', 'AND', 'SUB', 'XOR', 'CMP']
const conditions = ['JO', 'JNO', 'JB', 'JAE', 'JE', 'JNE', 'JBE', 'JA', 'JS', 'JNS', 'JP', 'JNP', 'JL', 'JGE', 'JLE', 'JG']
const aliases: Record<string, string> = { JZ: 'JE', JNZ: 'JNE', JC: 'JB', JNC: 'JAE', JNAE: 'JB', JNB: 'JAE', JNA: 'JBE', JNBE: 'JA', JPE: 'JP', JPO: 'JNP', JNGE: 'JL', JNL: 'JGE', JNG: 'JLE', JNLE: 'JG', SAL: 'SHL', RETN: 'RET' }
const one: Record<string, number> = { DAA: 0x27, DAS: 0x2f, AAA: 0x37, AAS: 0x3f, XLAT: 0xd7, INT3: 0xcc, INTO: 0xce, NOP: 0x90, HLT: 0xf4, CLC: 0xf8, STC: 0xf9, CMC: 0xf5, CLI: 0xfa, STI: 0xfb, CLD: 0xfc, STD: 0xfd, CBW: 0x98, CWD: 0x99, PUSHF: 0x9c, POPF: 0x9d, SAHF: 0x9e, LAHF: 0x9f, RET: 0xc3, RETF: 0xcb, IRET: 0xcf, MOVSB: 0xa4, MOVSW: 0xa5, CMPSB: 0xa6, CMPSW: 0xa7, STOSB: 0xaa, STOSW: 0xab, LODSB: 0xac, LODSW: 0xad, SCASB: 0xae, SCASW: 0xaf }
export const instructions = [...Object.keys(one), ...aluNames, ...conditions, ...Object.keys(aliases), 'MOV', 'TEST', 'INC', 'DEC', 'PUSH', 'POP', 'XCHG', 'LEA', 'LES', 'LDS', 'CALL', 'JMP', 'INT', 'LOOP', 'LOOPE', 'LOOPNE', 'JCXZ', 'NOT', 'NEG', 'MUL', 'IMUL', 'DIV', 'IDIV', 'ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SAR', 'REP', 'REPE', 'REPNE', 'AAM', 'AAD']

interface Operand { reg?: number, seg?: number, width: number, memory?: string, segment?: number, immediate?: string, far?: boolean }
function operand(text: string): Operand {
	const far = /^FAR\s+(?:PTR\s+)?/i.test(text)
	text = text.replace(/^FAR\s+(?:PTR\s+)?/i, '')
	let value = text.trim().toUpperCase(), width = 0
	if (/^(BYTE|WORD)\s+(PTR\s+)?/.test(value)) { width = value.startsWith('BYTE') ? 8 : 16; value = value.replace(/^(BYTE|WORD)\s+(PTR\s+)?/, '') }
	const reg = words.indexOf(value as typeof words[number]), byte = bytes.indexOf(value), seg = segments.indexOf(value)
	if (reg >= 0) return { reg, width: 16 }
	if (byte >= 0) return { reg: byte, width: 8 }
	if (seg >= 0) return { seg, width: 16 }
	const original = text.trim().replace(/^(BYTE|WORD)\s+(PTR\s+)?/i, '')
	const match = /^(?:(ES|CS|SS|DS):)?\[(.*)\]$/i.exec(original)
	if (match) return { memory: match[2], width, segment: match[1] ? segments.indexOf(match[1].toUpperCase()) : undefined, far }
	return { immediate: text, width }
}
const le = (value: number, width = 2) => Array.from({ length: width }, (_, i) => (value >>> (i * 8)) & 255)
function modrm(op: Operand, reg: number, ctx: CpuEncodingContext): number[] {
	if (op.reg !== undefined) return [0xc0 | (reg << 3) | op.reg]
	if (op.memory === undefined) throw new Error('Expected register or memory operand')
	const components = op.memory.replace(/\s/g, '').split(/(?=[+-])/)
	const registers: string[] = [], terms: string[] = []
	for (const component of components) {
		const positive = component.replace(/^\+/, '').toUpperCase()
		if (['BX', 'BP', 'SI', 'DI'].includes(positive)) registers.push(positive)
		else terms.push(component)
	}
	const key = registers.sort().join('+')
	const forms = ['BX+SI', 'BX+DI', 'BP+SI', 'BP+DI', 'SI', 'DI', 'BP', 'BX']
	if (!key) return [(reg << 3) | 6, ...le(ctx.value(terms.join('') || '0'))]
	const rm = forms.indexOf(key)
	if (rm < 0) throw new Error(`Invalid 8086 effective address [${op.memory}]`)
	// Fixed disp16 keeps forward-reference layout stable and covers all 8086 EA forms.
	return [0x80 | (reg << 3) | rm, ...le(ctx.value(terms.join('') || '0'))]
}
export type CpuModel = '8086' | '8088' | '80186' | '80188'
export const laterCpu = (model: CpuModel) => model === '80186' || model === '80188'
export type MathCoprocessor = 'none' | Coprocessor
export const extendedInstructions = ['PUSHA', 'POPA', 'ENTER', 'LEAVE', 'BOUND', 'INSB', 'INSW', 'OUTSB', 'OUTSW']

export function encode(mnemonic: string, texts: readonly string[], ctx: CpuEncodingContext, model: CpuModel = '8086', coprocessor: MathCoprocessor = 'none'): number[] {
	let name = mnemonic.toUpperCase()
	name = aliases[name] ?? name
	if (name === 'WAIT' || name === 'FWAIT') { if (texts.length) throw new Error('WAIT takes no operands'); return [0x9b] }
	if (name.startsWith('F')) {
		if (coprocessor === 'none') throw new Error('Enable the 8087 or 80187 coprocessor to assemble floating-point instructions')
		let segment: number | undefined
		const encoded = encode8087(name, texts, ctx, (text, field) => {
			const op = operand(text)
			if (op.memory === undefined) throw new Error('8087 requires a memory operand')
			segment = op.segment
			return modrm(op, field, ctx)
		}, coprocessor)
		if (segment === undefined) return encoded
		const prefix = [0x26, 0x2e, 0x36, 0x3e][segment]
		return encoded[0] === 0x9b ? [0x9b, prefix, ...encoded.slice(1)] : [prefix, ...encoded]
	}
	if (name === 'REP' || name === 'REPE' || name === 'REPNE') {
		if (texts.length !== 1) throw new Error('REP requires a string instruction')
		return [name === 'REPNE' ? 0xf2 : 0xf3, ...encode(texts[0], [], { ...ctx, address: ctx.address + 1 }, model)]
	}
	if (name in one && texts.length === 0) return [one[name]]
	if (extendedInstructions.includes(name) && !laterCpu(model)) throw new Error(`${name} requires 80186/80188`)
	const simple186: Record<string, number> = { PUSHA: 0x60, POPA: 0x61, LEAVE: 0xc9, INSB: 0x6c, INSW: 0x6d, OUTSB: 0x6e, OUTSW: 0x6f }
	if (name in simple186 && !texts.length) return [simple186[name]]
	if (name === 'ENTER' && texts.length === 2) { const size = ctx.value(texts[0]), level = ctx.value(texts[1]); if (size < 0 || size > 65535 || level < 0 || level > 255) throw new Error('ENTER operands require imm16,imm8'); return [0xc8, ...le(size), level] }
	const a = operand(texts[0] ?? ''), b = operand(texts[1] ?? '')
	const segment = a.segment ?? b.segment
	const prefix = segment === undefined ? [] : [[0x26, 0x2e, 0x36, 0x3e][segment]]
	const result = (): number[] => {
		const width = a.width || b.width || 16, w = width === 16 ? 1 : 0
		if (a.width && b.width && a.width !== b.width && !['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SAR'].includes(name)) throw new Error('8086 operand widths must agree')
		const rm = (op: Operand, r: number) => modrm(op, r, ctx)
		const immediate = (op: Operand) => { if (!op.immediate) throw new Error('Expected immediate'); return ctx.value(op.immediate) }
		if (name === 'MOV') {
			if (a.seg !== undefined) { if (a.seg === 1) throw new Error('MOV cannot load CS'); return [0x8e, ...rm(b, a.seg)] }
			if (b.seg !== undefined) return [0x8c, ...rm(a, b.seg)]
			if (b.immediate !== undefined) return a.reg !== undefined ? [0xb0 + (w << 3) + a.reg, ...le(immediate(b), w + 1)] : [0xc6 + w, ...rm(a, 0), ...le(immediate(b), w + 1)]
			if (a.reg !== undefined) return [0x8a + w, ...rm(b, a.reg)]
			if (b.reg !== undefined) return [0x88 + w, ...rm(a, b.reg)]
		}
		const operation = aluNames.indexOf(name)
		if (operation >= 0) {
			if (b.immediate !== undefined) return [0x80 + w, ...rm(a, operation), ...le(immediate(b), w + 1)]
			if (a.reg !== undefined) return [(operation << 3) + 2 + w, ...rm(b, a.reg)]
			if (b.reg !== undefined) return [(operation << 3) + w, ...rm(a, b.reg)]
		}
		if (name === 'TEST') return b.immediate !== undefined ? [0xf6 + w, ...rm(a, 0), ...le(immediate(b), w + 1)] : [0x84 + w, ...rm(a, b.reg ?? -1)]
		if (name === 'XCHG') return [0x86 + w, ...rm(a, b.reg ?? -1)]
		if (name === 'LEA' && a.reg !== undefined && b.memory !== undefined) return [0x8d, ...rm(b, a.reg)]
		if ((name === 'LES' || name === 'LDS') && a.reg !== undefined && a.width === 16 && b.memory !== undefined) return [name === 'LES' ? 0xc4 : 0xc5, ...rm(b, a.reg)]
		if (name === 'INC' || name === 'DEC') return a.reg !== undefined && w ? [(name === 'INC' ? 0x40 : 0x48) + a.reg] : [0xfe + w, ...rm(a, name === 'INC' ? 0 : 1)]
		if (name === 'BOUND' && a.reg !== undefined && a.width === 16 && b.memory !== undefined) return [0x62, ...rm(b, a.reg)]
		if (name === 'IMUL' && texts.length === 3 && a.reg !== undefined && a.width === 16 && (b.memory !== undefined || b.reg !== undefined) && b.width !== 8) { if (!laterCpu(model)) throw new Error('Immediate IMUL requires 80186/80188'); return [0x69, ...rm(b, a.reg), ...le(ctx.value(texts[2]))] }
		if (name === 'PUSH' && a.immediate !== undefined && laterCpu(model)) return [0x68, ...le(immediate(a))]
		if (name === 'PUSH' || name === 'POP') {
			if (a.width === 8 || a.immediate !== undefined) throw new Error('8086 PUSH/POP needs a word register or memory operand')
			if (a.reg !== undefined && a.width === 16) return [(name === 'PUSH' ? 0x50 : 0x58) + a.reg]
			if (a.seg !== undefined && !(name === 'POP' && a.seg === 1)) return [(a.seg << 3) + (name === 'PUSH' ? 6 : 7)]
			return name === 'PUSH' ? [0xff, ...rm(a, 6)] : [0x8f, ...rm(a, 0)]
		}
		if (name === 'CALL' || name === 'JMP') {
			if (a.reg !== undefined || a.memory !== undefined) { if (a.far && a.memory === undefined) throw new Error('Indirect far target must be memory'); return [0xff, ...rm(a, (name === 'CALL' ? 2 : 4) + (a.far ? 1 : 0))] }
			if (a.immediate?.includes(':')) { const [seg, offset] = a.immediate.split(':'); return [name === 'CALL' ? 0x9a : 0xea, ...le(ctx.value(offset)), ...le(ctx.value(seg))] }
			return [name === 'CALL' ? 0xe8 : 0xe9, ...le(immediate(a) - ctx.address - prefix.length - 3)]
		}
		if (name === 'RET' || name === 'RETF') return [name === 'RET' ? 0xc2 : 0xca, ...le(immediate(a))]
		if (name === 'INT') return [0xcd, immediate(a) & 255]
		if (name === 'AAM' || name === 'AAD') return [name === 'AAM' ? 0xd4 : 0xd5, texts.length ? immediate(a) & 255 : 10]
		const condition = conditions.indexOf(name), loop = ['LOOPNE', 'LOOPE', 'LOOP', 'JCXZ'].indexOf(name)
		if (condition >= 0 || loop >= 0) { const delta = immediate(a) - ctx.address - 2; if (delta < -128 || delta > 127) throw new Error('Short branch target outside -128..127 bytes'); return [condition >= 0 ? 0x70 + condition : 0xe0 + loop, delta & 255] }
		const unary = ['TEST', '', 'NOT', 'NEG', 'MUL', 'IMUL', 'DIV', 'IDIV'].indexOf(name)
		if (unary >= 2) return [0xf6 + w, ...rm(a, unary)]
		const shift = ['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', '', 'SAR'].indexOf(name)
		if (shift >= 0) { if (laterCpu(model) && texts[1]?.toUpperCase() !== 'CL' && ctx.value(texts[1] ?? '1') !== 1) { const count = ctx.value(texts[1]); if (count < 0 || count > 255) throw new Error('Shift count requires imm8'); return [0xc0 + w, ...rm(a, shift), count] } if (texts[1]?.toUpperCase() !== 'CL' && ctx.value(texts[1] ?? '1') !== 1) throw new Error('8086 shifts accept 1 or CL'); return [0xd0 + w + (texts[1]?.toUpperCase() === 'CL' ? 2 : 0), ...rm(a, shift)] }
		throw new Error(`Unsupported 8086 instruction or operands: ${mnemonic} ${texts.join(', ')}`)
	}
	return [...prefix, ...result()]
}

function get(c: CpuContext, reg: number, width: number) { return width === 16 ? c.r[reg] & 65535 : (c.r[reg & 3] >>> (reg >= 4 ? 8 : 0)) & 255 }
function put(c: CpuContext, reg: number, width: number, value: number) {
	if (width === 16) c.r[reg] = value & 65535
	else { const i = reg & 3, shift = reg >= 4 ? 8 : 0; c.r[i] = (c.r[i] & ~(255 << shift)) | ((value & 255) << shift) }
}
function flag(c: CpuContext, mask: number, value: boolean) { c.r[13] = value ? c.r[13] | mask : c.r[13] & ~mask }
function parity(value: number) { let n = value & 255; n ^= n >>> 4; return ((0x6996 >>> (n & 15)) & 1) === 0 }
function resultFlags(c: CpuContext, result: number, width: number) { const value = result & (width === 16 ? 65535 : 255); flag(c, ZF, value === 0); flag(c, SF, !!(value & (1 << (width - 1)))); flag(c, PF, parity(value)); return value }
function alu(c: CpuContext, op: number, a: number, b: number, width: number) {
	const mask = width === 16 ? 65535 : 255, sign = 1 << (width - 1), carry = c.r[13] & CF
	let value: number
	if (op === 1 || op === 4 || op === 6) { value = op === 1 ? a | b : op === 4 ? a & b : a ^ b; flag(c, CF | OF, false) }
	else { const sub = op === 3 || op === 5 || op === 7, addend = b + ((op === 2 || op === 3) ? carry : 0); value = sub ? a - addend : a + addend; flag(c, CF, sub ? a < addend : value > mask); flag(c, OF, !!((sub ? (a ^ b) & (a ^ value) : ~(a ^ b) & (a ^ value)) & sign)); flag(c, AF, !!((a ^ b ^ value) & 16)) }
	return resultFlags(c, value, width)
}
function address(c: CpuContext, segment: number, offset: number) { return c.segmentAddress(c.r[8 + segment], offset, 4, 20, 16) }
function readSegmentFor(c: CpuContext, segment: number, offset: number, bytes: number, model: CpuModel) { return c.readSegment(c.r[8 + segment], offset, bytes, 4, 20, laterCpu(model) ? 20 : 16) }
function writeSegmentFor(c: CpuContext, segment: number, offset: number, value: number, bytes: number, model: CpuModel) { c.writeSegment(c.r[8 + segment], offset, value, bytes, 4, 20, laterCpu(model) ? 20 : 16) }
function pushFor(c: CpuContext, value: number, model: CpuModel) { c.r[4] = (c.r[4] - 2) & 65535; writeSegmentFor(c, 2, c.r[4], value, 2, model) }
function popFor(c: CpuContext, model: CpuModel) { const offset = c.r[4], value = readSegmentFor(c, 2, offset, 2, model); c.r[4] = (offset + 2) & 65535; return value }
function jump(c: CpuContext, offset: number) { c.r[12] = offset & 65535; c.pc = address(c, 1, c.r[12]) }

export function decode(memory: Uint8Array, start: number, cpu?: CpuContext, model: CpuModel = '8086', coprocessor: MathCoprocessor = 'none'): CpuInstruction {
	const readSegment = (c: CpuContext, segment: number, offset: number, bytes: number) => readSegmentFor(c, segment, offset, bytes, model)
	const writeSegment = (c: CpuContext, segment: number, offset: number, value: number, bytes: number) => writeSegmentFor(c, segment, offset, value, bytes, model)
	const push = (c: CpuContext, value: number) => pushFor(c, value, model), pop = (c: CpuContext) => popFor(c, model)
	let p = start, segment = -1, repeat = 0
	const byte = () => {
		const offset = p++ - start
		if (offset >= 15) throw new Error('8086 instruction exceeds the simulator’s 15-byte decode limit')
		const value = memory[cpu ? cpu.segmentAddress(cpu.r[9], start - (cpu.r[9] << 4) + offset) : (start + offset) % memory.length]
		if (value === undefined) throw new Error('Incomplete 8086 instruction')
		return value
	}
	const word = () => byte() | (byte() << 8)
	let opcode = byte()
	while ([0x26, 0x2e, 0x36, 0x3e, 0xf2, 0xf3, 0xf0].includes(opcode)) { if (opcode === 0xf2 || opcode === 0xf3) repeat = opcode; else if (opcode !== 0xf0) segment = [0x26, 0x2e, 0x36, 0x3e].indexOf(opcode); opcode = byte() }
	let text: string, execute: (c: CpuContext) => void, call = false, kind: CpuInstruction['kind'] = 'alu'
	const rm = (width: number) => {
		const modrm = byte(), mode = modrm >>> 6, reg = (modrm >>> 3) & 7, r = modrm & 7
		let displacement = mode === 1 ? (byte() << 24) >> 24 : mode === 2 || (mode === 0 && r === 6) ? word() : 0
		if (mode === 2 && displacement & 32768) displacement -= 65536
		const ea = (c: CpuContext) => { const bases = [c.r[3] + c.r[6], c.r[3] + c.r[7], c.r[5] + c.r[6], c.r[5] + c.r[7], c.r[6], c.r[7], mode === 0 ? 0 : c.r[5], c.r[3]]; return (bases[r] + displacement) & 65535 }
		const seg = segment >= 0 ? segment : (r === 2 || r === 3 || (r === 6 && mode !== 0)) ? 2 : 3
		const read = (c: CpuContext) => mode === 3 ? get(c, r, width) : readSegment(c, seg, ea(c), width / 8)
		const write = (c: CpuContext, value: number) => { if (mode === 3) put(c, r, width, value); else writeSegment(c, seg, ea(c), value, width / 8) }
		const pointer = (c: CpuContext, offset: number) => readSegment(c, seg, ea(c) + offset, 2)
		return { encoding: modrm, reg, r, mode, ea, read, write, pointer, location: (c: CpuContext) => address(c, seg, ea(c)), segment: (c: CpuContext) => c.r[8 + seg], offset: ea, label: mode === 3 ? (width === 16 ? words[r] : bytes[r]) : mode === 0 && r === 6 ? `[0x${displacement.toString(16)}]` : `[${['BX+SI', 'BX+DI', 'BP+SI', 'BP+DI', 'SI', 'DI', 'BP', 'BX'][r]}${displacement < 0 ? '' : '+'}${displacement}]` }
	}
	const interrupt = (c: CpuContext, vector: number) => {
		const offset = c.read(vector * 4, 2, true), seg = c.read(vector * 4 + 2, 2, true)
		if (!offset && !seg) throw new Error(`Unhandled x86 interrupt ${vector}`)
		push(c, c.r[13]); push(c, c.r[9]); push(c, c.r[12])
		c.r[13] &= ~0x300; c.r[9] = seg; jump(c, offset)
	}
	if (opcode >= 0xd8 && opcode <= 0xdf) {
		if (coprocessor === 'none') throw new Error('No math coprocessor is enabled')
		return { ...decode8087(opcode, rm(16), coprocessor), size: p - start }
	}
	if (opcode === 0x9b) { text = 'WAIT'; kind = 'system'; execute = c => { if (coprocessor !== 'none') wait8087(c) } }
	else if (laterCpu(model) && (opcode === 0x60 || opcode === 0x61)) {
		text = opcode === 0x60 ? 'PUSHA' : 'POPA'
		execute = c => {
			if (opcode === 0x60) { const original = c.r[4]; for (let i = 0; i < 8; i++) push(c, i === 4 ? original : c.r[i]) }
			else for (let i = 7; i >= 0; i--) { const value = pop(c); if (i !== 4) c.r[i] = value }
		}
	} else if (laterCpu(model) && (opcode === 0x68 || opcode === 0x6a)) {
		const value = opcode === 0x68 ? word() : byte() << 24 >> 24
		text = `PUSH ${value}`; execute = c => push(c, value)
	} else if (laterCpu(model) && (opcode === 0x69 || opcode === 0x6b)) {
		const operand = rm(16), immediate = opcode === 0x69 ? word() << 16 >> 16 : byte() << 24 >> 24
		text = `IMUL ${words[operand.reg]}, ${operand.label}, ${immediate}`
		execute = c => { const value = (operand.read(c) << 16 >> 16) * immediate; c.r[operand.reg] = value & 65535; flag(c, CF | OF, value < -32768 || value > 32767) }
	} else if (laterCpu(model) && opcode === 0x62) {
		const operand = rm(16)
		if (operand.mode === 3) throw new Error('BOUND requires a memory pair')
		text = `BOUND ${words[operand.reg]}, ${operand.label}`; kind = 'system'
		execute = c => { const value = c.r[operand.reg] << 16 >> 16, lower = operand.read(c) << 16 >> 16, upper = operand.pointer(c, 2) << 16 >> 16; if (value < lower || value > upper) interrupt(c, 5) }
	} else if (laterCpu(model) && opcode === 0xc8) {
		const size = word(), level = byte()
		text = `ENTER ${size}, ${level}`
		execute = c => {
			push(c, c.r[5]); const frame = c.r[4]
			if (level) { for (let i = 1; i < level; i++) { c.r[5] = (c.r[5] - 2) & 65535; push(c, readSegment(c, 2, c.r[5], 2)) } push(c, frame) }
			c.r[5] = frame; c.r[4] = (c.r[4] - size) & 65535
		}
	} else if (laterCpu(model) && opcode === 0xc9) {
		text = 'LEAVE'; execute = c => { c.r[4] = c.r[5]; c.r[5] = pop(c) }
	} else if (laterCpu(model) && opcode >= 0x6c && opcode <= 0x6f) {
		text = ['INSB', 'INSW', 'OUTSB', 'OUTSW'][opcode - 0x6c]; kind = 'system'
		execute = () => { throw new Error('x86 I/O-port devices are not attached') }
	} else if ((opcode & 0xf0) === 0xb0) { const width = opcode & 8 ? 16 : 8, r = opcode & 7, value = width === 16 ? word() : byte(); text = `MOV ${width === 16 ? words[r] : bytes[r]}, ${value}`; execute = c => put(c, r, width, value) }
	else if (opcode <= 0x3d && (opcode & 7) <= 5 && (opcode & 7) !== 6) {
		const operation = opcode >>> 3, width = opcode & 1 ? 16 : 8
		if (opcode & 4) { const immediate = width === 16 ? word() : byte(); text = `${aluNames[operation]} ${width === 16 ? 'AX' : 'AL'}, ${immediate}`; execute = c => { const value = alu(c, operation, get(c, 0, width), immediate, width); if (operation !== 7) put(c, 0, width, value) } }
		else { const operand = rm(width), direction = !!(opcode & 2); text = `${aluNames[operation]} ${direction ? (width === 16 ? words : bytes)[operand.reg] : operand.label}, ${direction ? operand.label : (width === 16 ? words : bytes)[operand.reg]}`; execute = c => { const value = alu(c, operation, direction ? get(c, operand.reg, width) : operand.read(c), direction ? operand.read(c) : get(c, operand.reg, width), width); if (operation !== 7) { if (direction) put(c, operand.reg, width, value); else operand.write(c, value) } } }
	}
	else if (opcode >= 0x80 && opcode <= 0x83) { const width = opcode & 1 ? 16 : 8, operand = rm(width), immediate = opcode === 0x83 ? (byte() << 24) >> 24 : width === 16 ? word() : byte(); text = `${aluNames[operand.reg]} ${operand.label}, ${immediate}`; execute = c => { const value = alu(c, operand.reg, operand.read(c), immediate & (width === 16 ? 65535 : 255), width); if (operand.reg !== 7) operand.write(c, value) } }
	else if (opcode >= 0x88 && opcode <= 0x8b) { const width = opcode & 1 ? 16 : 8, operand = rm(width), direction = !!(opcode & 2); text = `MOV ${direction ? (width === 16 ? words : bytes)[operand.reg] : operand.label}, ${direction ? operand.label : (width === 16 ? words : bytes)[operand.reg]}`; kind = direction ? 'load' : 'store'; execute = c => { if (direction) put(c, operand.reg, width, operand.read(c)); else operand.write(c, get(c, operand.reg, width)) } }
	else if (opcode === 0x8c || opcode === 0x8e) { const operand = rm(16); if (operand.reg > 3 || (opcode === 0x8e && operand.reg === 1)) throw new Error('Invalid segment register'); text = `MOV ${opcode === 0x8e ? segments[operand.reg] : operand.label}, ${opcode === 0x8e ? operand.label : segments[operand.reg]}`; execute = c => { if (opcode === 0x8e) c.r[8 + operand.reg] = operand.read(c); else operand.write(c, c.r[8 + operand.reg]) } }
	else if (opcode === 0xc6 || opcode === 0xc7) { const width = opcode & 1 ? 16 : 8, operand = rm(width), value = width === 16 ? word() : byte(); if (operand.reg) throw new Error('Invalid MOV encoding'); text = `MOV ${operand.label}, ${value}`; kind = 'store'; execute = c => operand.write(c, value) }
	else if (opcode >= 0x40 && opcode <= 0x4f) { const reg = opcode & 7, dec = !!(opcode & 8); text = `${dec ? 'DEC' : 'INC'} ${words[reg]}`; execute = c => { const carry = c.r[13] & CF; put(c, reg, 16, alu(c, dec ? 5 : 0, get(c, reg, 16), 1, 16)); flag(c, CF, !!carry) } }
	else if (opcode >= 0x50 && opcode <= 0x5f) { const reg = opcode & 7, pull = !!(opcode & 8); text = `${pull ? 'POP' : 'PUSH'} ${words[reg]}`; execute = c => { if (pull) put(c, reg, 16, pop(c)); else push(c, !laterCpu(model) && reg === 4 ? (c.r[4] - 2) & 65535 : get(c, reg, 16)) } }
	else if ([6, 7, 14, 22, 23, 30, 31].includes(opcode)) { const seg = opcode >>> 3, pull = !!(opcode & 1); text = `${pull ? 'POP' : 'PUSH'} ${segments[seg]}`; execute = c => { if (pull) c.r[8 + seg] = pop(c); else push(c, c.r[8 + seg]) } }
	else if (opcode === 0x8f) { const operand = rm(16); if (operand.reg) throw new Error('Invalid POP encoding'); text = `POP ${operand.label}`; execute = c => operand.write(c, pop(c)) }
	else if (opcode === 0xc4 || opcode === 0xc5) { const operand = rm(16); if (operand.mode === 3) throw new Error('LES/LDS needs a far memory pointer'); text = `${opcode === 0xc4 ? 'LES' : 'LDS'} ${words[operand.reg]}, ${operand.label}`; kind = 'load'; execute = c => { const offset = operand.pointer(c, 0), seg = operand.pointer(c, 2); put(c, operand.reg, 16, offset); c.r[opcode === 0xc4 ? 8 : 11] = seg } }
	else if (opcode === 0x8d) { const operand = rm(16); if (operand.mode === 3) throw new Error('LEA needs memory operand'); text = `LEA ${words[operand.reg]}, ${operand.label}`; execute = c => put(c, operand.reg, 16, operand.ea(c)) }
	else if (opcode === 0x86 || opcode === 0x87) { const width = opcode & 1 ? 16 : 8, operand = rm(width); text = `XCHG ${operand.label}, ${(width === 16 ? words : bytes)[operand.reg]}`; execute = c => { const value = operand.read(c); operand.write(c, get(c, operand.reg, width)); put(c, operand.reg, width, value) } }
	else if (opcode >= 0x91 && opcode <= 0x97) { const reg = opcode & 7; text = `XCHG AX, ${words[reg]}`; execute = c => { const value = c.r[0]; c.r[0] = c.r[reg]; c.r[reg] = value } }
	else if (opcode === 0x84 || opcode === 0x85) { const width = opcode & 1 ? 16 : 8, operand = rm(width); text = `TEST ${operand.label}, ${(width === 16 ? words : bytes)[operand.reg]}`; execute = c => { alu(c, 4, operand.read(c), get(c, operand.reg, width), width) } }
	else if (opcode === 0xf6 || opcode === 0xf7) { const width = opcode & 1 ? 16 : 8, operand = rm(width), operation = operand.reg, immediate = operation === 0 ? width === 16 ? word() : byte() : 0; text = `${['TEST', '?', 'NOT', 'NEG', 'MUL', 'IMUL', 'DIV', 'IDIV'][operation]} ${operand.label}`; execute = c => { const b = operand.read(c), mask = width === 16 ? 65535 : 255; if (operation === 0) alu(c, 4, b, immediate, width); else if (operation === 2) operand.write(c, ~b); else if (operation === 3) operand.write(c, alu(c, 5, 0, b, width)); else if (operation === 4 || operation === 5) { const signed = (v: number) => width === 16 ? (v << 16) >> 16 : (v << 24) >> 24; const value = operation === 5 ? signed(get(c, 0, width)) * signed(b) : get(c, 0, width) * b; if (width === 16) { c.r[0] = value & 65535; c.r[2] = (value >>> 16) & 65535 } else c.r[0] = value & 65535; const overflow = operation === 5 ? value !== signed(value & mask) : value > mask; flag(c, CF | OF, overflow) } else if (operation >= 6) { if (b === 0) throw new Error('8086 division by zero'); const signed = operation === 7; let dividend = width === 16 ? c.r[2] * 65536 + c.r[0] : c.r[0], divisor = b; if (signed) { dividend = width === 16 ? dividend | 0 : (dividend << 16) >> 16; divisor = width === 16 ? (b << 16) >> 16 : (b << 24) >> 24 } const quotient = Math.trunc(dividend / divisor), remainder = dividend % divisor; if (quotient < (signed ? -(1 << (width - 1)) + (laterCpu(model) ? 0 : 1) : 0) || quotient > (signed ? (1 << (width - 1)) - 1 : mask)) throw new Error('8086 division overflow'); if (width === 16) { c.r[0] = quotient & mask; c.r[2] = remainder & mask } else c.r[0] = (quotient & 255) | ((remainder & 255) << 8) } else throw new Error('Invalid unary opcode') } }
	else if (opcode === 0xd4 || opcode === 0xd5) { const base = byte(); text = `${opcode === 0xd4 ? 'AAM' : 'AAD'} ${base}`; execute = c => { const al = c.r[0] & 255, ah = c.r[0] >>> 8; if (opcode === 0xd4) { if (!base) throw new Error('8086 AAM division by zero'); c.r[0] = ((Math.floor(al / base) & 255) << 8) | (al % base) } else c.r[0] = (ah * base + al) & 255; resultFlags(c, c.r[0] & 255, 8) } }
	else if (opcode >= 0xd0 && opcode <= 0xd3 || laterCpu(model) && (opcode === 0xc0 || opcode === 0xc1)) { const width = opcode & 1 ? 16 : 8, operand = rm(width), operation = operand.reg, immediate = opcode < 0xd0 ? byte() : null; text = `${['ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', '?', 'SAR'][operation]} ${operand.label}, ${immediate ?? (opcode & 2 ? 'CL' : '1')}`; execute = c => { const count = (immediate ?? (opcode & 2 ? c.r[1] & 255 : 1)) & (laterCpu(model) ? 31 : 255), mask = width === 16 ? 65535 : 255, sign = 1 << (width - 1); let value = operand.read(c); const original = value; for (let i = 0; i < count; i++) { const carry = c.r[13] & CF; if (operation === 0 || operation === 2 || operation === 4) { const top = !!(value & sign); value = ((value << 1) | (operation === 0 ? +top : operation === 2 ? carry : 0)) & mask; flag(c, CF, top) } else if ([1, 3, 5, 7].includes(operation)) { const low = value & 1; value = (value >>> 1) | (operation === 1 ? low * sign : operation === 3 ? carry * sign : operation === 7 ? value & sign : 0); flag(c, CF, !!low) } else throw new Error('Invalid shift'); } if (count) { operand.write(c, value); if (operation >= 4) resultFlags(c, value, width); if (count === 1) flag(c, OF, operation === 5 ? !!(original & sign) : operation === 7 ? false : operation === 1 || operation === 3 ? !!((value ^ (value << 1)) & sign) : !!((value & sign) ^ ((c.r[13] & CF) * sign))) } } }
	else if (opcode === 0xfe || opcode === 0xff) { const width = opcode & 1 ? 16 : 8, operand = rm(width), operation = operand.reg; text = `${['INC', 'DEC', 'CALL', 'CALL FAR', 'JMP', 'JMP FAR', 'PUSH'][operation]} ${operand.label}`; call = operation === 2 || operation === 3; kind = call ? 'call' : operation === 4 || operation === 5 ? 'jump' : 'alu'; execute = c => { if (operation < 2) { const carry = c.r[13] & CF; operand.write(c, alu(c, operation ? 5 : 0, operand.read(c), 1, width)); flag(c, CF, !!carry) } else if (operation === 2 || operation === 4) { const target = operand.read(c); if (operation === 2) { const ret = c.pc; push(c, c.r[12]); c.call(address(c, 1, target), ret) } jump(c, target) } else if (operation === 3 || operation === 5) { if (operand.mode === 3) throw new Error('Far target must be memory'); const target = operand.pointer(c, 0), seg = operand.pointer(c, 2), ret = c.pc; if (operation === 3) { push(c, c.r[9]); push(c, c.r[12]) } c.r[9] = seg; if (operation === 3) c.call(address(c, 1, target), ret); jump(c, target) } else if (operation === 6) push(c, !laterCpu(model) && operand.mode === 3 && operand.r === 4 ? (c.r[4] - 2) & 65535 : operand.read(c)); else throw new Error('Invalid FF opcode') } }
	else if (opcode === 0xe8 || opcode === 0xe9 || opcode === 0xeb) { const delta = opcode === 0xeb ? (byte() << 24) >> 24 : (word() << 16) >> 16; call = opcode === 0xe8; kind = call ? 'call' : 'jump'; text = `${call ? 'CALL' : 'JMP'} ${(p + delta) & 0xfffff}`; execute = c => { const target = (c.r[12] + delta) & 65535; if (call) { const ret = c.pc; push(c, c.r[12]); c.call(address(c, 1, target), ret) } jump(c, target) } }
	else if (opcode === 0xea || opcode === 0x9a) { const offset = word(), seg = word(); call = opcode === 0x9a; kind = call ? 'call' : 'jump'; text = `${call ? 'CALL' : 'JMP'} ${seg}:${offset}`; execute = c => { const ret = c.pc; if (call) { push(c, c.r[9]); push(c, c.r[12]) } c.r[9] = seg; if (call) c.call(address(c, 1, offset), ret); jump(c, offset) } }
	else if (opcode >= 0x70 && opcode <= 0x7f) { const condition = opcode & 15, delta = (byte() << 24) >> 24; text = `${conditions[condition]} ${(p + delta) & 0xfffff}`; kind = 'branch'; execute = c => { const f = c.r[13], carry = !!(f & CF), zero = !!(f & ZF), sign = !!(f & SF), overflow = !!(f & OF), parity = !!(f & PF); const values = [overflow, !overflow, carry, !carry, zero, !zero, carry || zero, !carry && !zero, sign, !sign, parity, !parity, sign !== overflow, sign === overflow, zero || sign !== overflow, !zero && sign === overflow]; const target = (c.r[12] + delta) & 65535; c.branch(address(c, 1, target), values[condition]); if (values[condition]) jump(c, target) } }
	else if (opcode >= 0xe0 && opcode <= 0xe3) { const delta = (byte() << 24) >> 24; text = `${['LOOPNE', 'LOOPE', 'LOOP', 'JCXZ'][opcode & 3]} ${(p + delta) & 0xfffff}`; kind = 'branch'; execute = c => { if (opcode !== 0xe3) c.r[1] = (c.r[1] - 1) & 65535; const take = opcode === 0xe3 ? c.r[1] === 0 : c.r[1] !== 0 && (opcode === 0xe2 || (opcode === 0xe1 ? !!(c.r[13] & ZF) : !(c.r[13] & ZF))); const target = (c.r[12] + delta) & 65535; c.branch(address(c, 1, target), take); if (take) jump(c, target) } }
	else if ([0xc2, 0xc3, 0xca, 0xcb, 0xcf].includes(opcode)) { const adjustment = opcode === 0xc2 || opcode === 0xca ? word() : 0; text = opcode === 0xcf ? 'IRET' : opcode >= 0xca ? 'RETF' : 'RET'; kind = 'return'; execute = c => { const offset = pop(c); if (opcode >= 0xca) c.r[9] = pop(c); if (opcode === 0xcf) c.r[13] = (pop(c) & 0x0fd5) | 0xf002; c.r[4] = (c.r[4] + adjustment) & 65535; c.ret(address(c, 1, offset)); jump(c, offset) } }
	else if (opcode === 0xcd || opcode === 0xcc || opcode === 0xce) { const vector = opcode === 0xcd ? byte() : opcode === 0xcc ? 3 : 4; text = `INT ${vector}`; kind = 'system'; execute = c => { if (opcode === 0xce && !(c.r[13] & OF)) return; if (vector === 0x80) { switch (c.r[0]) { case 0: c.halt(); break; case 1: c.output(String((c.r[3] << 16) >> 16)); break; case 2: c.output(String.fromCharCode(c.r[3] & 255)); break; case 3: { let offset = c.r[3], value: number, count = 0; while ((value = c.read(address(c, 3, offset++))) !== 0 && count++ < 65536) c.output(String.fromCharCode(value)); break } case 4: c.r[0] = c.inputInteger(16) & 65535; break; default: throw new Error('Unknown 8086 monitor service') } } else if (vector === 0x21 && (c.r[0] >>> 8) === 2) c.output(String.fromCharCode(c.r[2] & 255)); else if (vector === 0x21 && (c.r[0] >>> 8) === 0x4c) c.halt(); else { interrupt(c, vector) } } }
	else if (opcode >= 0xa0 && opcode <= 0xa3) { const offset = word(), width = opcode & 1 ? 16 : 8, store = !!(opcode & 2); text = `MOV ${store ? `[${offset}], ${width === 16 ? 'AX' : 'AL'}` : `${width === 16 ? 'AX' : 'AL'}, [${offset}]`}`; execute = c => { const seg = segment < 0 ? 3 : segment; if (store) writeSegment(c, seg, offset, get(c, 0, width), width / 8); else put(c, 0, width, readSegment(c, seg, offset, width / 8)) } }
	else if ([0xa4, 0xa5, 0xa6, 0xa7, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf].includes(opcode)) { const width = opcode & 1 ? 16 : 8, amount = width / 8; text = `${repeat ? repeat === 0xf2 ? 'REPNE ' : 'REP ' : ''}${Object.entries(one).find(([, value]) => value === opcode)?.[0]}`; execute = c => { const step = (c.r[13] & DF) ? -amount : amount; const comparison = opcode === 0xa6 || opcode === 0xa7 || opcode === 0xae || opcode === 0xaf; do { if (repeat && c.r[1] === 0) break; const sourceSegment = segment < 0 ? 3 : segment; if (opcode === 0xa4 || opcode === 0xa5) writeSegment(c, 0, c.r[7], readSegment(c, sourceSegment, c.r[6], amount), amount); else if (opcode === 0xaa || opcode === 0xab) writeSegment(c, 0, c.r[7], get(c, 0, width), amount); else if (opcode === 0xac || opcode === 0xad) put(c, 0, width, readSegment(c, sourceSegment, c.r[6], amount)); else alu(c, 7, opcode === 0xa6 || opcode === 0xa7 ? readSegment(c, sourceSegment, c.r[6], amount) : get(c, 0, width), readSegment(c, 0, c.r[7], amount), width); if (opcode <= 0xa7 || opcode === 0xac || opcode === 0xad) c.r[6] = (c.r[6] + step) & 65535; if (opcode <= 0xab || opcode >= 0xae) c.r[7] = (c.r[7] + step) & 65535; if (!repeat) break; c.r[1] = (c.r[1] - 1) & 65535; if (comparison && (!!(c.r[13] & ZF) !== (repeat === 0xf3))) break } while (c.r[1]) } }
	else { text = Object.entries(one).find(([, value]) => value === opcode)?.[0] ?? ''; if (!text) throw new Error(`Unsupported 8086 opcode 0x${opcode.toString(16)} at 0x${start.toString(16)}`); execute = c => { switch (opcode) { case 0x27: case 0x2f: { const old = c.r[0] & 255, subtract = opcode === 0x2f, oldCarry = !!(c.r[13] & CF); let value = old; const low = (old & 15) > 9 || !!(c.r[13] & AF); if (low) value += subtract ? -6 : 6; flag(c, AF, low); const high = old > 0x99 || oldCarry; if (high) value += subtract ? -0x60 : 0x60; flag(c, CF, high); put(c, 0, 8, resultFlags(c, value, 8)); break } case 0x37: case 0x3f: { const adjust = (c.r[0] & 15) > 9 || !!(c.r[13] & AF); if (adjust) { const direction = opcode === 0x37 ? 1 : -1; const value = (c.r[0] + direction * 6) & 65535; c.r[0] = (value + direction * 256) & 65535 } c.r[0] = (c.r[0] & 0xff00) | (c.r[0] & 15); flag(c, AF | CF, adjust); break } case 0xd7: put(c, 0, 8, c.read(address(c, segment < 0 ? 3 : segment, c.r[3] + (c.r[0] & 255)))); break; case 0x90: break; case 0xf4: c.halt(); break; case 0xf8: flag(c, CF, false); break; case 0xf9: flag(c, CF, true); break; case 0xf5: flag(c, CF, !(c.r[13] & CF)); break; case 0xfa: flag(c, 512, false); break; case 0xfb: flag(c, 512, true); break; case 0xfc: flag(c, DF, false); break; case 0xfd: flag(c, DF, true); break; case 0x98: c.r[0] = ((c.r[0] << 24) >> 24) & 65535; break; case 0x99: c.r[2] = c.r[0] & 32768 ? 65535 : 0; break; case 0x9c: push(c, c.r[13]); break; case 0x9d: c.r[13] = (pop(c) & 0x0fd5) | 0xf002; break; case 0x9e: c.r[13] = (c.r[13] & ~0xd5) | ((c.r[0] >>> 8) & 0xd5) | 2; break; case 0x9f: c.r[0] = (c.r[0] & 255) | ((c.r[13] & 255) << 8); break } } }
	return { size: p - start, text, execute, call, kind, ...dependencies(text, segment) }
}
/** Static register dependencies are calculated once per decoded instruction. */
function dependencies(text: string, segment: number) {
	const reads = new Set<string>(), writes = new Set<string>()
	const aliases: Record<string, string> = { al: 'ax', ah: 'ax', cl: 'cx', ch: 'cx', dl: 'dx', dh: 'dx', bl: 'bx', bh: 'bx' }
	const add = (target: Set<string>, value: string) => { for (const token of value.toLowerCase().match(/[a-z]+/g) ?? []) { const id = aliases[token] ?? token; if (names.some(name => name.toLowerCase() === id)) target.add(id) } }
	const pieces = text.split(/\s+/), mnemonic = pieces.shift()!, operands = pieces.join(' ').split(',')
	const destination = operands[0] ?? '', source = operands.slice(1).join(',')
	const destinationRegister = /^(?:AX|CX|DX|BX|SP|BP|SI|DI|AL|CL|DL|BL|AH|CH|DH|BH|ES|CS|SS|DS)$/i.test(destination.trim())
	const memory = operands.filter(value => value.includes('[')).join(' ')
	add(reads, memory)
	if (memory) reads.add(segments[segment >= 0 ? segment : /\bBP\b/.test(memory) ? 2 : 3].toLowerCase())
	if (mnemonic === 'MOV' || mnemonic === 'LEA' || mnemonic === 'LES' || mnemonic === 'LDS') {
		add(reads, source)
		if (destinationRegister) add(writes, destination)
		if (mnemonic === 'LES' || mnemonic === 'LDS') writes.add(mnemonic === 'LES' ? 'es' : 'ds')
	} else if ([...aluNames, 'TEST', 'INC', 'DEC', 'NEG', 'NOT', 'ROL', 'ROR', 'RCL', 'RCR', 'SHL', 'SHR', 'SAR', 'XCHG'].includes(mnemonic)) {
		add(reads, destination); add(reads, source)
		if (!['CMP', 'TEST'].includes(mnemonic) && destinationRegister) add(writes, destination)
		if (mnemonic === 'XCHG') add(writes, source)
		if (!['NOT', 'XCHG'].includes(mnemonic)) writes.add('flags')
		if (['ADC', 'SBB', 'INC', 'DEC', 'RCL', 'RCR'].includes(mnemonic)) reads.add('flags')
	} else if (['MUL', 'IMUL', 'DIV', 'IDIV'].includes(mnemonic)) {
		add(reads, destination); reads.add('ax'); writes.add('ax')
		if (!/^(?:AL|CL|DL|BL|AH|CH|DH|BH)$/.test(destination)) { writes.add('dx'); if (mnemonic.endsWith('DIV')) reads.add('dx') }
		writes.add('flags')
	} else if (mnemonic === 'PUSH' || mnemonic === 'POP' || mnemonic.startsWith('CALL') || mnemonic.startsWith('RET') || mnemonic === 'IRET' || mnemonic === 'PUSHF' || mnemonic === 'POPF') {
		reads.add('sp'); reads.add('ss'); writes.add('sp')
		if (mnemonic === 'PUSH') add(reads, destination)
		if (mnemonic === 'POP' && destinationRegister) add(writes, destination)
		if (mnemonic === 'PUSHF') reads.add('flags')
		if (mnemonic === 'POPF' || mnemonic === 'IRET') writes.add('flags')
		if (mnemonic.startsWith('CALL') || mnemonic.startsWith('RET') || mnemonic === 'IRET') { reads.add('cs'); reads.add('ip'); writes.add('ip'); add(reads, destination) }
		if (text.includes('FAR') || destination.includes(':') || mnemonic === 'RETF' || mnemonic === 'IRET') writes.add('cs')
	} else if (conditions.includes(mnemonic)) { reads.add('flags'); reads.add('ip'); reads.add('cs'); writes.add('ip') }
	else if (mnemonic.startsWith('LOOP') || mnemonic === 'JCXZ') { reads.add('cx'); reads.add('ip'); reads.add('cs'); writes.add('ip'); if (mnemonic !== 'JCXZ') writes.add('cx'); if (mnemonic === 'LOOPE' || mnemonic === 'LOOPNE') reads.add('flags') }
	else if (mnemonic === 'JMP') { add(reads, destination); reads.add('cs'); writes.add('ip'); if (destination.includes(':') || text.includes('FAR')) writes.add('cs') }
	else if (mnemonic.startsWith('REP') || /^(MOVS|CMPS|STOS|LODS|SCAS)[BW]$/.test(mnemonic)) {
		const native = mnemonic.startsWith('REP') ? pieces[0] : mnemonic
		reads.add('flags')
		if (mnemonic.startsWith('REP')) { reads.add('cx'); writes.add('cx') }
		if (/^(MOVS|CMPS|LODS)/.test(native)) { reads.add(segment >= 0 ? segments[segment].toLowerCase() : 'ds'); reads.add('si'); writes.add('si') }
		if (/^(MOVS|CMPS|STOS|SCAS)/.test(native)) { reads.add('es'); reads.add('di'); writes.add('di') }
		if (/^(STOS|SCAS)/.test(native)) reads.add('ax')
		if (native.startsWith('LODS')) writes.add('ax')
		if (/^(CMPS|SCAS)/.test(native)) writes.add('flags')
	} else if (mnemonic === 'CBW') { reads.add('ax'); writes.add('ax') }
	else if (mnemonic === 'CWD') { reads.add('ax'); writes.add('dx') }
	else if (['DAA', 'DAS', 'AAA', 'AAS', 'AAM', 'AAD', 'SAHF', 'LAHF'].includes(mnemonic)) { reads.add('ax'); reads.add('flags'); writes.add('ax'); writes.add('flags') }
	else if (mnemonic === 'XLAT') { reads.add('ax'); reads.add('bx'); reads.add(segment >= 0 ? segments[segment].toLowerCase() : 'ds'); writes.add('ax') }
	else if (['CLC', 'STC', 'CMC', 'CLI', 'STI', 'CLD', 'STD'].includes(mnemonic)) { reads.add('flags'); writes.add('flags') }
	else if (mnemonic === 'INT') { reads.add('ax'); reads.add('bx'); reads.add('ds'); reads.add('flags'); reads.add('sp'); reads.add('ss'); writes.add('ax'); writes.add('flags'); writes.add('sp'); writes.add('cs'); writes.add('ip') }
	return { reads: [...reads], writes: [...writes] }
}
