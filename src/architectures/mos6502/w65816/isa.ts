import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../../core/configuredCpu'

import { registerNames } from './metadata'
export { registerNames } from './metadata'
const C = 1, Z = 2, I = 4, D = 8, X = 16, M = 32, V = 64, N = 128
const rows = [
	'BRK:sig ORA:dix COP:sig ORA:sr TSB:dp ORA:dp ASL:dp ORA:dil PHP:imp ORA:im ASL:acc PHD:imp TSB:abs ORA:abs ASL:abs ORA:long',
	'BPL:rel ORA:diy ORA:di ORA:sriy TRB:dp ORA:dpx ASL:dpx ORA:dily CLC:imp ORA:absy INC:acc TCS:imp TRB:abs ORA:absx ASL:absx ORA:longx',
	'JSR:abs AND:dix JSL:long AND:sr BIT:dp AND:dp ROL:dp AND:dil PLP:imp AND:im ROL:acc PLD:imp BIT:abs AND:abs ROL:abs AND:long',
	'BMI:rel AND:diy AND:di AND:sriy BIT:dpx AND:dpx ROL:dpx AND:dily SEC:imp AND:absy DEC:acc TSC:imp BIT:absx AND:absx ROL:absx AND:longx',
	'RTI:imp EOR:dix WDM:sig EOR:sr MVP:block EOR:dp LSR:dp EOR:dil PHA:imp EOR:im LSR:acc PHK:imp JMP:abs EOR:abs LSR:abs EOR:long',
	'BVC:rel EOR:diy EOR:di EOR:sriy MVN:block EOR:dpx LSR:dpx EOR:dily CLI:imp EOR:absy PHY:imp TCD:imp JML:long EOR:absx LSR:absx EOR:longx',
	'RTS:imp ADC:dix PER:rell ADC:sr STZ:dp ADC:dp ROR:dp ADC:dil PLA:imp ADC:im ROR:acc RTL:imp JMP:ind ADC:abs ROR:abs ADC:long',
	'BVS:rel ADC:diy ADC:di ADC:sriy STZ:dpx ADC:dpx ROR:dpx ADC:dily SEI:imp ADC:absy PLY:imp TDC:imp JMP:indx ADC:absx ROR:absx ADC:longx',
	'BRA:rel STA:dix BRL:rell STA:sr STY:dp STA:dp STX:dp STA:dil DEY:imp BIT:im TXA:imp PHB:imp STY:abs STA:abs STX:abs STA:long',
	'BCC:rel STA:diy STA:di STA:sriy STY:dpx STA:dpx STX:dpy STA:dily TYA:imp STA:absy TXS:imp TXY:imp STZ:abs STA:absx STZ:absx STA:longx',
	'LDY:ix LDA:dix LDX:ix LDA:sr LDY:dp LDA:dp LDX:dp LDA:dil TAY:imp LDA:im TAX:imp PLB:imp LDY:abs LDA:abs LDX:abs LDA:long',
	'BCS:rel LDA:diy LDA:di LDA:sriy LDY:dpx LDA:dpx LDX:dpy LDA:dily CLV:imp LDA:absy TSX:imp TYX:imp LDY:absx LDA:absx LDX:absy LDA:longx',
	'CPY:ix CMP:dix REP:sig CMP:sr CPY:dp CMP:dp DEC:dp CMP:dil INY:imp CMP:im DEX:imp WAI:imp CPY:abs CMP:abs DEC:abs CMP:long',
	'BNE:rel CMP:diy CMP:di CMP:sriy PEI:di CMP:dpx DEC:dpx CMP:dily CLD:imp CMP:absy PHX:imp STP:imp JML:indl CMP:absx DEC:absx CMP:longx',
	'CPX:ix SBC:dix SEP:sig SBC:sr CPX:dp SBC:dp INC:dp SBC:dil INX:imp SBC:im NOP:imp XBA:imp CPX:abs SBC:abs INC:abs SBC:long',
	'BEQ:rel SBC:diy SBC:di SBC:sriy PEA:abs SBC:dpx INC:dpx SBC:dily SED:imp SBC:absy PLX:imp XCE:imp JSR:indx SBC:absx INC:absx SBC:longx',
]
const table = rows.flatMap(row => row.split(' ').map(entry => { const [name, mode] = entry.split(':'); return { name, mode } }))
export const instructions = [...new Set(table.map(entry => entry.name)), 'LDA.B', 'LDA.W', 'LDX.B', 'LDX.W', 'LDY.B', 'LDY.W', 'ADC.B', 'ADC.W', 'SBC.B', 'SBC.W', 'CMP.B', 'CMP.W', 'CPX.B', 'CPX.W', 'CPY.B', 'CPY.W', 'AND.B', 'AND.W', 'ORA.B', 'ORA.W', 'EOR.B', 'EOR.W', 'BIT.B', 'BIT.W']
const length: Record<string, number> = { imp: 1, acc: 1, sig: 2, rel: 2, rell: 3, dp: 2, dpx: 2, dpy: 2, dix: 2, di: 2, diy: 2, dil: 2, dily: 2, sr: 2, sriy: 2, abs: 3, absx: 3, absy: 3, ind: 3, indx: 3, indl: 3, long: 4, longx: 4, block: 3 }
const little = (value: number, bytes: number) => Array.from({ length: bytes }, (_, index) => (value >>> (index * 8)) & 255)
function parse(mnemonic: string, operands: readonly string[]) {
	const [name, rawSuffix] = mnemonic.toUpperCase().split('.'), suffix = rawSuffix?.toLowerCase(), text = operands.join(',').trim(), upper = text.toUpperCase()
	let mode: string, expression = text.replace(/^#/, '')
	if (!text) mode = table.some(op => op.name === name && op.mode === 'acc') ? 'acc' : 'imp'
	else if (upper === 'A') mode = 'acc'
	else if (name === 'MVN' || name === 'MVP') mode = 'block'
	else if (['BRK', 'COP', 'WDM', 'REP', 'SEP'].includes(name)) mode = 'sig'
	else if (name === 'BRL' || name === 'PER') mode = 'rell'
	else if (/^B(PL|MI|VC|VS|RA|CC|CS|NE|EQ)$/.test(name)) mode = 'rel'
	else if (text.startsWith('#')) mode = ['LDX', 'LDY', 'CPX', 'CPY'].includes(name) ? 'ix' : 'im'
	else if (/^\(.+,S\),Y$/i.test(upper)) { mode = 'sriy'; expression = text.slice(1, -5) }
	else if (/^.+,S$/i.test(upper)) { mode = 'sr'; expression = text.slice(0, -2) }
	else if (/^\[.+\],Y$/i.test(upper)) { mode = 'dily'; expression = text.slice(1, -3) }
	else if (/^\[.+\]$/.test(upper)) { mode = name === 'JML' || name === 'JMP' ? 'indl' : 'dil'; expression = text.slice(1, -1) }
	else if (/^\(.+,X\)$/i.test(upper)) { mode = name === 'JMP' || name === 'JSR' ? 'indx' : 'dix'; expression = text.slice(1, -3) }
	else if (/^\(.+\),Y$/i.test(upper)) { mode = 'diy'; expression = text.slice(1, -3) }
	else if (/^\(.+\)$/.test(upper)) { mode = name === 'JMP' ? 'ind' : 'di'; expression = text.slice(1, -1) }
	else {
		const index = /,([XY])$/i.exec(text)?.[1].toLowerCase() ?? ''
		expression = text.replace(/,[XY]$/i, '')
		mode = suffix === 'l' || expression.startsWith('|') || name === 'JSL' || name === 'JML' ? 'long' + index : suffix === 'd' || expression.startsWith('<') ? 'dp' + index : 'abs' + index
		expression = expression.replace(/^[<|]/, '')
	}
	if (mode === 'imp' && ['BRK', 'COP', 'WDM'].includes(name)) { mode = 'sig'; expression = '0' }
	const opcode = table.findIndex(op => op.name === name && op.mode === mode)
	if (opcode < 0) throw new Error(`Unsupported 65C816 instruction/address mode: ${mnemonic} ${text}`)
	return { name, mode, expression, opcode, size: mode === 'im' || mode === 'ix' ? suffix === 'w' ? 3 : 2 : length[mode] }
}
export function instructionSize(mnemonic: string, operands: readonly string[]) { return parse(mnemonic, operands).size }
export function encode(mnemonic: string, operands: readonly string[], context: CpuEncodingContext): number[] {
	const op = parse(mnemonic, operands)
	if (op.mode === 'block') { if (operands.length !== 2) throw new Error('Block move needs source,destination banks'); return [op.opcode, context.value(operands[1]), context.value(operands[0])] }
	let value = op.size === 1 ? 0 : context.value(op.expression)
	if (op.mode === 'rel' || op.mode === 'rell') { value -= context.address + op.size; if (op.mode === 'rel' && (value < -128 || value > 127)) throw new Error('Branch target outside -128..127 bytes') }
	return [op.opcode, ...little(value, op.size - 1)]
}
function isM8(c: CpuContext) { return !!(c.r[8] || (c.r[4] & M)) }
function isX8(c: CpuContext) { return !!(c.r[8] || (c.r[4] & X)) }
export function enforceWidths(c: CpuContext) { if (c.r[8]) { c.r[4] |= M | X; c.r[3] = 0x100 | (c.r[3] & 255) } if (isX8(c)) { c.r[1] &= 255; c.r[2] &= 255 } }
function flag(c: CpuContext, mask: number, value: boolean) { c.r[4] = value ? c.r[4] | mask : c.r[4] & ~mask }
function nz(c: CpuContext, value: number, width: number) { const result = value & (width === 8 ? 255 : 65535); flag(c, Z, result === 0); flag(c, N, !!(result & (1 << (width - 1)))); return result }
function putA(c: CpuContext, value: number, width: number, flags = true) { const result = flags ? nz(c, value, width) : value; c.r[0] = width === 8 ? (c.r[0] & 0xff00) | (result & 255) : result & 65535 }
function push(c: CpuContext, value: number, count = 1) { for (let index = count - 1; index >= 0; index--) { c.write(c.r[3], value >>> (index * 8)); c.r[3] = c.r[8] ? 0x100 | ((c.r[3] - 1) & 255) : (c.r[3] - 1) & 65535 } }
function pop(c: CpuContext, count = 1) { let value = 0; for (let index = 0; index < count; index++) { c.r[3] = c.r[8] ? 0x100 | ((c.r[3] + 1) & 255) : (c.r[3] + 1) & 65535; value |= c.read(c.r[3]) << (index * 8) } return value }
function bank(c: CpuContext, value: number, program = false) { return c.segmentAddress(c.r[program ? 7 : 6], value, 16, 24, 16) }
function jump(c: CpuContext, target: number) { c.pc = target & 0xffffff; c.r[7] = c.pc >>> 16 }
function arithmetic(c: CpuContext, a: number, b: number, subtract: boolean, width: number) {
	const mask = width === 8 ? 255 : 65535, sign = 1 << (width - 1), carry = c.r[4] & C
	const binary = subtract ? a - b - (1 - carry) : a + b + carry
	flag(c, V, !!((subtract ? (a ^ b) : ~(a ^ b)) & (a ^ binary) & sign))
	let value = binary
	if (c.r[4] & D) {
		let result = 0, digitCarry = subtract ? carry - 1 : carry
		for (let shift = 0; shift < width; shift += 4) {
			let digit = ((a >>> shift) & 15) + (subtract ? -((b >>> shift) & 15) : ((b >>> shift) & 15)) + digitCarry
			if (subtract) { digitCarry = digit < 0 ? -1 : 0; if (digit < 0) digit -= 6 }
			else { if (digit > 9) digit += 6; digitCarry = digit > 15 ? 1 : 0 }
			result |= (digit & 15) << shift
		}
		value = result; flag(c, C, subtract ? digitCarry === 0 : digitCarry !== 0)
	} else flag(c, C, subtract ? binary >= 0 : binary > mask)
	return value & mask
}

export function decode(memory: Uint8Array, address: number, cpu?: CpuContext, sourceBytes?: number): CpuInstruction {
	const opcode = memory[address % memory.length], { name, mode } = table[opcode]
	const m8 = mode === 'im' && sourceBytes !== undefined ? sourceBytes === 2 : cpu ? isM8(cpu) : true
	const x8 = mode === 'ix' && sourceBytes !== undefined ? sourceBytes === 2 : cpu ? isX8(cpu) : true
	const width = ['LDX', 'LDY', 'STX', 'STY', 'CPX', 'CPY'].includes(name) ? x8 ? 8 : 16 : m8 ? 8 : 16
	const size = mode === 'im' ? m8 ? 2 : 3 : mode === 'ix' ? x8 ? 2 : 3 : length[mode]
	const at = (offset: number) => memory[((address & 0xff0000) | ((address + offset) & 65535)) % memory.length]
	const operand = at(1) | (size > 2 ? at(2) << 8 : 0) | (size > 3 ? at(3) << 16 : 0)
	const rel = mode === 'rel' ? (operand << 24) >> 24 : (operand << 16) >> 16
	const call = name === 'JSR' || name === 'JSL'
	const readPointer = (c: CpuContext, pointer: number, count: number, direct = false) => { let value = 0; for (let i = 0; i < count; i++) { const pointerAddress = direct && c.r[8] && !(c.r[5] & 255) ? (pointer & 0xff00) | ((pointer + i) & 255) : (pointer & 0xff0000) | ((pointer + i) & 65535); value |= c.read(pointerAddress) << (i * 8) } return value }
	const ea = (c: CpuContext) => {
		const dp = (c.r[5] + operand) & 65535
		const dpx = (c.r[5] + operand + c.r[1]) & 65535, dpy = (c.r[5] + operand + c.r[2]) & 65535
		switch (mode) {
			case 'dp': return dp
			case 'dpx': return c.r[8] && !(c.r[5] & 255) ? (c.r[5] & 0xff00) | ((operand + c.r[1]) & 255) : dpx
			case 'dpy': return c.r[8] && !(c.r[5] & 255) ? (c.r[5] & 0xff00) | ((operand + c.r[2]) & 255) : dpy
			case 'dix': return bank(c, readPointer(c, c.r[8] && !(c.r[5] & 255) ? (c.r[5] & 0xff00) | ((operand + c.r[1]) & 255) : dpx, 2, true))
			case 'di': return bank(c, readPointer(c, dp, 2, true))
			case 'diy': return (bank(c, readPointer(c, dp, 2, true)) + c.r[2]) & 0xffffff
			case 'dil': return readPointer(c, dp, 3, true)
			case 'dily': return (readPointer(c, dp, 3, true) + c.r[2]) & 0xffffff
			case 'sr': return (c.r[3] + operand) & 65535
			case 'sriy': return (bank(c, readPointer(c, (c.r[3] + operand) & 65535, 2)) + c.r[2]) & 0xffffff
			case 'abs': return bank(c, operand)
			case 'absx': return (bank(c, operand) + c.r[1]) & 0xffffff
			case 'absy': return (bank(c, operand) + c.r[2]) & 0xffffff
			case 'long': return operand
			case 'longx': return (operand + c.r[1]) & 0xffffff
			default: throw new Error(`No memory address for ${mode}`)
		}
	}
	const read = (c: CpuContext) => mode === 'im' || mode === 'ix' ? operand : mode === 'acc' ? c.r[0] & (width === 8 ? 255 : 65535) : c.read(ea(c), width / 8, true)
	const write = (c: CpuContext, value: number) => { if (mode === 'acc') putA(c, value, width, false); else c.write(ea(c), value, width / 8, true) }
	const execute = (c: CpuContext) => {
		const mask = width === 8 ? 255 : 65535, a = c.r[0] & mask
		switch (name) {
			case 'LDA': putA(c, read(c), width); break
			case 'LDX': c.r[1] = nz(c, read(c), width); break
			case 'LDY': c.r[2] = nz(c, read(c), width); break
			case 'STA': write(c, a); break
			case 'STX': write(c, c.r[1]); break
			case 'STY': write(c, c.r[2]); break
			case 'STZ': write(c, 0); break
			case 'ORA': putA(c, a | read(c), width); break
			case 'AND': putA(c, a & read(c), width); break
			case 'EOR': putA(c, a ^ read(c), width); break
			case 'ADC': putA(c, arithmetic(c, a, read(c), false, width), width); break
			case 'SBC': putA(c, arithmetic(c, a, read(c), true, width), width); break
			case 'CMP': case 'CPX': case 'CPY': { const left = name === 'CMP' ? a : c.r[name === 'CPX' ? 1 : 2], right = read(c); nz(c, left - right, width); flag(c, C, left >= right); break }
			case 'BIT': { const value = read(c); flag(c, Z, (a & value) === 0); if (mode !== 'im') { flag(c, N, !!(value & (1 << (width - 1)))); flag(c, V, !!(value & (1 << (width - 2)))) } break }
			case 'TSB': case 'TRB': { const value = read(c); flag(c, Z, (a & value) === 0); write(c, name === 'TSB' ? value | a : value & ~a); break }
			case 'INC': case 'DEC': { const value = nz(c, read(c) + (name === 'INC' ? 1 : -1), width); write(c, value); break }
			case 'ASL': case 'LSR': case 'ROL': case 'ROR': { const value = read(c), carry = c.r[4] & C, left = name === 'ASL' || name === 'ROL'; flag(c, C, !!(value & (left ? 1 << (width - 1) : 1))); write(c, nz(c, left ? (value << 1) | (name === 'ROL' ? carry : 0) : (value >>> 1) | (name === 'ROR' ? carry << (width - 1) : 0), width)); break }
			case 'INX': case 'DEX': case 'INY': case 'DEY': { const reg = name.endsWith('X') ? 1 : 2; c.r[reg] = nz(c, c.r[reg] + (name.startsWith('IN') ? 1 : -1), x8 ? 8 : 16); break }
			case 'TAX': case 'TAY': { c.r[name === 'TAX' ? 1 : 2] = nz(c, c.r[0], x8 ? 8 : 16); break }
			case 'TXA': case 'TYA': putA(c, c.r[name === 'TXA' ? 1 : 2], m8 ? 8 : 16); break
			case 'TXY': case 'TYX': c.r[name === 'TXY' ? 2 : 1] = nz(c, c.r[name === 'TXY' ? 1 : 2], x8 ? 8 : 16); break
			case 'TSX': c.r[1] = nz(c, c.r[3], x8 ? 8 : 16); break
			case 'TXS': c.r[3] = c.r[8] ? 0x100 | (c.r[1] & 255) : c.r[1]; break
			case 'TCS': c.r[3] = c.r[8] ? 0x100 | (c.r[0] & 255) : c.r[0]; break
			case 'TSC': c.r[0] = nz(c, c.r[3], 16); break
			case 'TCD': c.r[5] = nz(c, c.r[0], 16); break
			case 'TDC': c.r[0] = nz(c, c.r[5], 16); break
			case 'XBA': c.r[0] = ((c.r[0] & 255) << 8) | (c.r[0] >>> 8); nz(c, c.r[0] & 255, 8); break
			case 'XCE': { const carry = c.r[4] & C; flag(c, C, !!c.r[8]); c.r[8] = carry; enforceWidths(c); break }
			case 'CLC': flag(c, C, false); break
			case 'SEC': flag(c, C, true); break
			case 'CLI': flag(c, I, false); break
			case 'SEI': flag(c, I, true); break
			case 'CLD': flag(c, D, false); break
			case 'SED': flag(c, D, true); break
			case 'CLV': flag(c, V, false); break
			case 'REP': c.r[4] &= ~operand; enforceWidths(c); break
			case 'SEP': c.r[4] |= operand; enforceWidths(c); break
			case 'PHP': push(c, c.r[4]); break
			case 'PLP': c.r[4] = pop(c); enforceWidths(c); break
			case 'PHA': push(c, c.r[0], m8 ? 1 : 2); break
			case 'PLA': putA(c, pop(c, m8 ? 1 : 2), m8 ? 8 : 16); break
			case 'PHX': case 'PHY': push(c, c.r[name === 'PHX' ? 1 : 2], x8 ? 1 : 2); break
			case 'PLX': case 'PLY': c.r[name === 'PLX' ? 1 : 2] = nz(c, pop(c, x8 ? 1 : 2), x8 ? 8 : 16); break
			case 'PHB': push(c, c.r[6]); break
			case 'PLB': c.r[6] = nz(c, pop(c), 8); break
			case 'PHK': push(c, c.r[7]); break
			case 'PHD': push(c, c.r[5], 2); break
			case 'PLD': c.r[5] = nz(c, pop(c, 2), 16); break
			case 'PEA': push(c, operand, 2); break
			case 'PER': push(c, (c.pc + rel) & 65535, 2); break
			case 'PEI': push(c, readPointer(c, (c.r[5] + operand) & 65535, 2, true), 2); break
			case 'JMP': case 'JML': case 'JSR': case 'JSL': {
				let target = mode === 'long' ? operand : mode === 'ind' ? bank(c, readPointer(c, operand, 2), true) : mode === 'indl' ? readPointer(c, operand, 3) : mode === 'indx' ? bank(c, readPointer(c, bank(c, operand + c.r[1], true), 2), true) : bank(c, operand, true)
				target &= 0xffffff
				if (call) { const returnAddress = c.pc; if (name === 'JSL') push(c, c.r[7]); push(c, (c.pc - 1) & 65535, 2); c.call(target, returnAddress) }
				jump(c, target); break
			}
			case 'RTS': case 'RTL': { const offset = (pop(c, 2) + 1) & 65535; if (name === 'RTL') c.r[7] = pop(c); const target = bank(c, offset, true); c.ret(target); jump(c, target); break }
			case 'RTI': { c.r[4] = pop(c); const offset = pop(c, 2); if (!c.r[8]) c.r[7] = pop(c); enforceWidths(c); jump(c, bank(c, offset, true)); break }
			case 'BRA': case 'BRL': case 'BPL': case 'BMI': case 'BVC': case 'BVS': case 'BCC': case 'BCS': case 'BNE': case 'BEQ': {
				const bit = name === 'BPL' || name === 'BMI' ? N : name === 'BVC' || name === 'BVS' ? V : name === 'BCC' || name === 'BCS' ? C : Z
				const take = name === 'BRA' || name === 'BRL' || (!!(c.r[4] & bit) === ['BMI', 'BVS', 'BCS', 'BEQ'].includes(name))
				const target = bank(c, (c.pc + rel) & 65535, true); c.branch(target, take); if (take) jump(c, target); break
			}
			case 'MVN': case 'MVP': { const destination = operand & 255, source = operand >>> 8; c.r[6] = destination; const value = c.read(c.segmentAddress(source, c.r[1], 16, 24)); c.write(c.segmentAddress(destination, c.r[2], 16, 24), value); const direction = name === 'MVN' ? 1 : -1; c.r[1] = (c.r[1] + direction) & (x8 ? 255 : 65535); c.r[2] = (c.r[2] + direction) & (x8 ? 255 : 65535); c.r[0] = (c.r[0] - 1) & 65535; if (c.r[0] !== 65535) jump(c, c.instructionAddress); break }
			case 'COP': case 'BRK': {
				const vector = c.r[8] ? name === 'COP' ? 0xfff4 : 0xfffe : name === 'COP' ? 0xffe4 : 0xffe6
				const target = c.read(vector, 2, true)
				if (target) { if (!c.r[8]) push(c, c.r[7]); push(c, c.pc & 65535, 2); push(c, c.r[4]); c.r[4] = (c.r[4] | I) & ~D; c.r[7] = 0; jump(c, target); break }
				if (name === 'BRK' && operand === 0) c.halt()
				else if (name === 'COP') { switch (operand) { case 0: c.halt(); break; case 1: c.output(String((c.r[0] << 16) >> 16)); break; case 2: c.output(String.fromCharCode(c.r[0] & 255)); break; case 3: { let offset = c.r[1], value: number, count = 0; while ((value = c.read(bank(c, offset++))) && count++ < 65536) c.output(String.fromCharCode(value)); break } case 4: c.r[0] = c.inputInteger(16) & 65535; break; default: throw new Error(`Unknown 65C816 monitor COP ${operand}`) } }
				else throw new Error('Unhandled 65C816 BRK')
				break
			}
			case 'WAI': throw new Error('65C816 WAI requires an interrupt source; none is configured')
			case 'STP': c.halt(); break
			case 'WDM': case 'NOP': break
			default: throw new Error(`Unsupported 65C816 operation ${name}`)
		}
	}
	const hex = `$${operand.toString(16)}`
	const displays: Record<string, string> = {
		imp: '', acc: 'A', sig: `#${hex}`, im: `#${hex}`, ix: `#${hex}`,
		dp: hex, dpx: `${hex},X`, dpy: `${hex},Y`, abs: hex, absx: `${hex},X`, absy: `${hex},Y`, long: hex, longx: `${hex},X`,
		dix: `(${hex},X)`, di: `(${hex})`, diy: `(${hex}),Y`, dil: `[${hex}]`, dily: `[${hex}],Y`, sr: `${hex},S`, sriy: `(${hex},S),Y`,
		ind: `(${hex})`, indx: `(${hex},X)`, indl: `[${hex}]`,
		block: `$${(operand >>> 8).toString(16)},$${(operand & 255).toString(16)}`,
		rel: `$${((address & 0xff0000) | ((address + size + rel) & 65535)).toString(16)}`,
		rell: `$${((address & 0xff0000) | ((address + size + rel) & 65535)).toString(16)}`,
	}
	const suffix = mode === 'im' || mode === 'ix' ? size === 3 ? '.W' : '.B' : ['dp', 'dpx', 'dpy'].includes(mode) ? '.D' : mode === 'long' || mode === 'longx' ? '.L' : ''
	const kind: CpuInstruction['kind'] = call ? 'call'
		: ['RTS', 'RTL', 'RTI'].includes(name) ? 'return'
			: ['JMP', 'JML'].includes(name) ? 'jump'
				: ['BRK', 'COP', 'STP', 'WAI'].includes(name) ? 'system'
					: name.startsWith('B') && mode.startsWith('rel') ? 'branch'
						: ['STA', 'STX', 'STY', 'STZ'].includes(name) ? 'store'
							: name.startsWith('LD') ? 'load' : 'alu'
	return { size, text: name + suffix + (displays[mode] ? ` ${displays[mode]}` : ''), execute, call, kind, ...dependencies(name, mode) }
}

function dependencies(name: string, mode: string) {
	const reads = new Set<string>(), writes = new Set<string>()
	const read = (...ids: string[]) => ids.forEach(id => reads.add(id))
	const write = (...ids: string[]) => ids.forEach(id => writes.add(id))
	if (['dp', 'dpx', 'dpy', 'dix', 'di', 'diy', 'dil', 'dily'].includes(mode)) read('d')
	if (['dpx', 'dix', 'absx', 'longx', 'indx'].includes(mode)) read('x')
	if (['dpy', 'diy', 'dily', 'absy', 'sriy'].includes(mode)) read('y')
	if (['sr', 'sriy'].includes(mode)) read('s')
	if (['abs', 'absx', 'absy', 'dix', 'di', 'diy', 'sriy'].includes(mode) && !['JMP', 'JSR', 'PEA', 'PEI'].includes(name)) read('dbr')
	if (['LDA', 'LDX', 'LDY'].includes(name)) write(name === 'LDA' ? 'a' : name === 'LDX' ? 'x' : 'y', 'p')
	else if (['STA', 'STX', 'STY'].includes(name)) read(name === 'STA' ? 'a' : name === 'STX' ? 'x' : 'y')
	else if (['ORA', 'AND', 'EOR', 'ADC', 'SBC'].includes(name)) { read('a'); write('a', 'p'); if (name === 'ADC' || name === 'SBC') read('p') }
	else if (['CMP', 'CPX', 'CPY', 'BIT', 'TSB', 'TRB'].includes(name)) { read(name === 'CPX' ? 'x' : name === 'CPY' ? 'y' : 'a'); write('p') }
	else if (['ASL', 'LSR', 'ROL', 'ROR', 'INC', 'DEC'].includes(name)) { if (mode === 'acc') { read('a'); write('a') } write('p'); if (name === 'ROL' || name === 'ROR') read('p') }
	else if (['INX', 'DEX', 'INY', 'DEY'].includes(name)) { const reg = name.endsWith('X') ? 'x' : 'y'; read(reg); write(reg, 'p') }
	else if (['TAX', 'TAY', 'TXA', 'TYA', 'TXY', 'TYX', 'TSX', 'TXS', 'TCS', 'TSC', 'TCD', 'TDC'].includes(name)) {
		const reg = (letter: string) => letter === 'C' ? 'a' : letter.toLowerCase()
		read(reg(name[1])); write(reg(name[2])); if (!['TXS', 'TCS'].includes(name)) write('p')
	} else if (name === 'XBA') { read('a'); write('a', 'p') }
	else if (name === 'XCE') { read('p', 'e', 's', 'x', 'y'); write('p', 'e', 's', 'x', 'y') }
	else if (['CLC', 'SEC', 'CLI', 'SEI', 'CLD', 'SED', 'CLV', 'REP', 'SEP'].includes(name)) { read('p'); write('p'); if (name === 'REP' || name === 'SEP') { read('e'); write('x', 'y') } }
	if (['PHP', 'PLP', 'PHA', 'PLA', 'PHX', 'PLX', 'PHY', 'PLY', 'PHB', 'PLB', 'PHK', 'PHD', 'PLD', 'PEA', 'PEI', 'PER', 'JSR', 'JSL', 'RTS', 'RTL', 'RTI', 'COP', 'BRK'].includes(name)) {
		read('s', 'e'); write('s')
		const stackRegisters: Record<string, string> = { PHP: 'p', PLP: 'p', PHA: 'a', PLA: 'a', PHX: 'x', PLX: 'x', PHY: 'y', PLY: 'y', PHB: 'dbr', PLB: 'dbr', PHK: 'pbr', PHD: 'd', PLD: 'd' }
		const reg = stackRegisters[name]
		if (reg) { if (name.startsWith('PH')) read(reg); else { write(reg); if (name !== 'PLP') write('p') } }
		if (name === 'JSL') read('pbr')
		if (['JSL', 'RTL', 'RTI', 'BRK', 'COP'].includes(name)) write('pbr')
		if (['RTI', 'BRK', 'COP'].includes(name)) { read('p'); write('p') }
		if (name === 'COP') { read('a', 'x', 'dbr'); write('a') }
	}
	if (name === 'MVN' || name === 'MVP') { read('a', 'x', 'y'); write('a', 'x', 'y', 'dbr') }
	if (name.startsWith('B') && mode === 'rel' && name !== 'BRA') read('p')
	if (['JMP', 'JSR', 'RTS', 'RTL', 'PER', 'BRL'].includes(name) || mode === 'rel') read('pbr')
	return { reads: [...reads], writes: [...writes] }
}
