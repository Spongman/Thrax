import type { CpuContext, CpuEncodingContext, CpuInstruction } from '../../core/configuredCpu'

// Intel MCS-51 User's Manual (1994); chapter 2 is the Programmer's Guide and Instruction Set.
// Mirrors: https://archive.org/download/bitsavers_intel8051M4_15073500/MCS-51_Users_Manual_Feb94.pdf (byte-identical)
// Mirrors: https://www.keil.com/dd/docs/datashts/intel/ism51.pdf (chapter 2 only; page numbers differ by 51)
export const reference = 'https://bitsavers.org/components/intel/8051/MCS-51_Users_Manual_Feb94.pdf'
export const CODE = 0, IRAM = 0x10000, SFR = 0x10100, XDATA = 0x20000
export const A = 0, B = 1, DPTR = 2, SP = 3, PSW = 4
const CY = 128, AC = 64, OV = 4
const directNames: Record<string, number> = { a: 0xe0, acc: 0xe0, b: 0xf0, dpl: 0x82, dph: 0x83, sp: 0x81, psw: 0xd0, p0: 0x80, p1: 0x90, p2: 0xa0, p3: 0xb0, tcon: 0x88, tmod: 0x89, tl0: 0x8a, tl1: 0x8b, th0: 0x8c, th1: 0x8d, scon: 0x98, sbuf: 0x99, ie: 0xa8, ip: 0xb8 }
const immediate = (s: string) => s.startsWith('#')
const rn = (s: string) => /^r[0-7]$/i.test(s) ? +s[1] : -1
const ri = (s: string) => /^@r[01]$/i.test(s) ? +s[2] : -1
const norm = (s: string) => s.toLowerCase().replace(/\s/g, '')
const single: Record<string, number> = { nop: 0, ret: 0x22, reti: 0x32 }
export const instructions = ['nop', 'ajmp', 'ljmp', 'rr', 'inc', 'jbc', 'acall', 'lcall', 'rrc', 'dec', 'jb', 'ret', 'rl', 'add', 'jnb', 'reti', 'rlc', 'addc', 'jc', 'orl', 'jnc', 'anl', 'jz', 'xrl', 'jnz', 'jmp', 'mov', 'sjmp', 'movc', 'div', 'subb', 'mul', 'cpl', 'cjne', 'push', 'clr', 'swap', 'xch', 'pop', 'setb', 'da', 'djnz', 'xchd', 'movx']
function bounded(value: number, max: number, min = 0): number { if (!Number.isInteger(value) || value < min || value > max) throw new Error(`8051 operand must be ${min}..${max}`); return value }
function direct(s: string, c: CpuEncodingContext): number { return bounded(directNames[norm(s)] ?? c.value(s), 255) }
function bitAddress(s: string, c: CpuEncodingContext): number {
	const parts = s.split('.')
	if (parts.length === 1) return bounded(c.value(s), 255)
	const byte = direct(parts[0], c), bit = c.value(parts[1])
	if (bit < 0 || bit > 7 || byte < 0x20 || byte >= 0x30 && (byte < 0x80 || byte % 8)) throw new Error('Not a bit-addressable 8051 byte')
	return byte < 0x80 ? (byte - 0x20) * 8 + bit : byte + bit
}
export function instructionSize(name: string, operands: readonly string[]): number {
	const n = norm(name), o = operands.map(norm), a = o[0] ?? '', b = o[1] ?? ''
	if (n in single || ['rr', 'rrc', 'rl', 'rlc', 'swap', 'da', 'mul', 'div'].includes(n)) return 1
	if (['ljmp', 'lcall', 'jbc', 'jb', 'jnb', 'cjne'].includes(n)) return 3
	if (['ajmp', 'acall', 'sjmp', 'jc', 'jnc', 'jz', 'jnz', 'push', 'pop'].includes(n)) return 2
	if (n === 'djnz') return rn(a) >= 0 ? 2 : 3
	if (n === 'jmp' || n === 'movx' || n === 'movc' || n === 'xchd') return 1
	if (['inc', 'dec'].includes(n)) return a === 'a' || a === 'dptr' || rn(a) >= 0 || ri(a) >= 0 ? 1 : 2
	if (['clr', 'cpl', 'setb'].includes(n)) return a === 'a' || a === 'c' ? 1 : 2
	if (n === 'xch') return rn(b) >= 0 || ri(b) >= 0 ? 1 : 2
	if (['add', 'addc', 'subb'].includes(n)) return rn(b) >= 0 || ri(b) >= 0 ? 1 : 2
	if (['anl', 'orl', 'xrl'].includes(n)) return a === 'a' ? rn(b) >= 0 || ri(b) >= 0 ? 1 : 2 : a === 'c' || b === 'a' ? 2 : 3
	if (n === 'mov') {
		if (a === 'dptr') return 3
		if (a === 'c' || b === 'c') return 2
		if (a === 'a') return rn(b) >= 0 || ri(b) >= 0 ? 1 : 2
		if (rn(a) >= 0 || ri(a) >= 0) return b === 'a' ? 1 : 2
		return b === 'a' || rn(b) >= 0 || ri(b) >= 0 ? 2 : 3
	}
	throw new Error(`Unknown 8051 instruction ${name}`)
}
export function encode(name: string, operands: readonly string[], c: CpuEncodingContext): number[] {
	const n = norm(name), o = operands.map(norm), a = o[0] ?? '', b = o[1] ?? '', size = instructionSize(n, operands)
	const operandCount = n in single ? 0 : n === 'cjne' ? 3 : ['mov', 'movc', 'movx', 'add', 'addc', 'subb', 'anl', 'orl', 'xrl', 'xch', 'xchd', 'jb', 'jnb', 'jbc', 'djnz'].includes(n) ? 2 : 1
	if (operands.length !== operandCount) throw new Error(`${name} needs ${operandCount} operands`)
	const original = (s: string) => operands[o.indexOf(s)] ?? s
	const value = (s: string) => c.value(original(s).replace(/^#/, '')), byteValue = (s: string) => bounded(value(s), 255, -128) & 255, dir = (s: string) => direct(original(s), c)
	const relative = (s: string) => { const v = c.value(original(s)) - c.address - size << 16 >> 16; if (v < -128 || v > 127) throw new Error('8051 relative branch exceeds signed 8-bit range'); return v & 255 }
	const source = (base: number, s: string): number[] => rn(s) >= 0 ? [base + 8 + rn(s)] : ri(s) >= 0 ? [base + 6 + ri(s)] : immediate(s) ? [base + 4, byteValue(s)] : [base + 5, dir(s)]
	if (n in single) return [single[n]]
	if (n === 'ljmp' || n === 'lcall') { const v = bounded(value(a), 65535); return [n === 'ljmp' ? 2 : 0x12, v >>> 8 & 255, v & 255] }
	if (n === 'ajmp' || n === 'acall') { const v = bounded(value(a), 65535); if ((v & 0xf800) !== (c.address + 2 & 0xf800)) throw new Error('AJMP/ACALL crosses a 2K page'); return [(n === 'ajmp' ? 1 : 0x11) | v >>> 3 & 0xe0, v & 255] }
	if (['sjmp', 'jc', 'jnc', 'jz', 'jnz'].includes(n)) return [{ sjmp: 0x80, jc: 0x40, jnc: 0x50, jz: 0x60, jnz: 0x70 }[n]!, relative(a)]
	if (['jb', 'jnb', 'jbc'].includes(n)) return [{ jb: 0x20, jnb: 0x30, jbc: 0x10 }[n]!, bitAddress(operands[0], c), relative(operands[1])]
	if (n === 'djnz') return rn(a) >= 0 ? [0xd8 + rn(a), relative(operands[1])] : [0xd5, dir(a), relative(operands[1])]
	if (n === 'cjne') { const tail = [immediate(b) ? byteValue(b) : dir(b), relative(operands[2])]; if (a === 'a') return [immediate(b) ? 0xb4 : 0xb5, ...tail]; if (!immediate(b)) throw new Error('CJNE Rn/@Ri requires immediate operand'); if (rn(a) >= 0) return [0xb8 + rn(a), ...tail]; if (ri(a) >= 0) return [0xb6 + ri(a), ...tail] }
	if (n === 'jmp' && a === '@a+dptr') return [0x73]
	if (n === 'movc' && a === 'a' && ['@a+dptr', '@a+pc'].includes(b)) return [b === '@a+dptr' ? 0x93 : 0x83]
	if (n === 'movx') { if (a === 'a' && (b === '@dptr' || ri(b) >= 0)) return [b === '@dptr' ? 0xe0 : 0xe2 + ri(b)]; if (b === 'a' && (a === '@dptr' || ri(a) >= 0)) return [a === '@dptr' ? 0xf0 : 0xf2 + ri(a)] }
	if (n === 'mov') {
		if (a === 'dptr' && immediate(b)) { const v = bounded(value(b), 65535, -32768); return [0x90, v >>> 8 & 255, v & 255] }
		if (a === 'c') return [0xa2, bitAddress(operands[1], c)]
		if (b === 'c') return [0x92, bitAddress(operands[0], c)]
		if (a === 'a') return source(0xe0, b).map((v, i) => i === 0 && immediate(b) ? 0x74 : v)
		if (rn(a) >= 0) return b === 'a' ? [0xf8 + rn(a)] : immediate(b) ? [0x78 + rn(a), byteValue(b)] : [0xa8 + rn(a), dir(b)]
		if (ri(a) >= 0) return b === 'a' ? [0xf6 + ri(a)] : immediate(b) ? [0x76 + ri(a), byteValue(b)] : [0xa6 + ri(a), dir(b)]
		if (b === 'a') return [0xf5, dir(a)]
		if (immediate(b)) return [0x75, dir(a), byteValue(b)]
		if (rn(b) >= 0) return [0x88 + rn(b), dir(a)]
		if (ri(b) >= 0) return [0x86 + ri(b), dir(a)]
		return [0x85, dir(b), dir(a)]
	}
	if (n === 'inc' || n === 'dec') { const base = n === 'inc' ? 0 : 0x10; if (a === 'dptr' && n === 'inc') return [0xa3]; if (a === 'a') return [base + 4]; if (rn(a) >= 0) return [base + 8 + rn(a)]; if (ri(a) >= 0) return [base + 6 + ri(a)]; return [base + 5, dir(a)] }
	if (['add', 'addc', 'subb'].includes(n) && a === 'a') return source({ add: 0x20, addc: 0x30, subb: 0x90 }[n]!, b)
	if (['anl', 'orl', 'xrl'].includes(n)) { const base = { orl: 0x40, anl: 0x50, xrl: 0x60 }[n]!; if (a === 'a') return source(base, b); if (a === 'c' && n !== 'xrl') return [(n === 'orl' ? 0x72 : 0x82) + (b.startsWith('/') ? 0x30 : 0), bitAddress(operands[1].replace(/^\//, ''), c)]; if (b === 'a') return [base + 2, dir(a)]; if (immediate(b)) return [base + 3, dir(a), byteValue(b)] }
	if (['clr', 'cpl', 'setb'].includes(n)) { if (a === 'a' && n !== 'setb') return [n === 'clr' ? 0xe4 : 0xf4]; if (a === 'c') return [{ clr: 0xc3, cpl: 0xb3, setb: 0xd3 }[n]!]; return [{ clr: 0xc2, cpl: 0xb2, setb: 0xd2 }[n]!, bitAddress(operands[0], c)] }
	if (n === 'push' || n === 'pop') return [n === 'push' ? 0xc0 : 0xd0, dir(a)]
	if (['rr', 'rrc', 'rl', 'rlc', 'swap', 'da'].includes(n) && a === 'a') return [{ rr: 3, rrc: 0x13, rl: 0x23, rlc: 0x33, swap: 0xc4, da: 0xd4 }[n]!]
	if ((n === 'mul' || n === 'div') && a === 'ab') return [n === 'mul' ? 0xa4 : 0x84]
	if (n === 'xch' && a === 'a') return rn(b) >= 0 ? [0xc8 + rn(b)] : ri(b) >= 0 ? [0xc6 + ri(b)] : [0xc5, dir(b)]
	if (n === 'xchd' && a === 'a' && ri(b) >= 0) return [0xd6 + ri(b)]
	throw new Error(`Unsupported 8051 operand form: ${name} ${operands.join(',')}`)
}
export function readDirect(c: CpuContext, address: number): number {
	if (address < 128) return c.read(IRAM + address)
	switch (address) { case 0xe0: return c.r[A]; case 0xf0: return c.r[B]; case 0x82: return c.r[DPTR] & 255; case 0x83: return c.r[DPTR] >>> 8; case 0x81: return c.r[SP]; case 0xd0: return c.r[PSW] }
	return c.read(SFR + address - 128)
}
export function parity(c: CpuContext): void { let v = c.r[A], p = 0; while (v) { p ^= v & 1; v >>>= 1 } c.r[PSW] = c.r[PSW] & 254 | p }
export function writeDirect(c: CpuContext, address: number, value: number): void {
	value &= 255
	if (address < 128) { c.write(IRAM + address, value); return }
	switch (address) { case 0xe0: c.r[A] = value; parity(c); return; case 0xf0: c.r[B] = value; return; case 0x82: c.r[DPTR] = c.r[DPTR] & 0xff00 | value; return; case 0x83: c.r[DPTR] = c.r[DPTR] & 255 | value << 8; return; case 0x81: c.r[SP] = value; return; case 0xd0: c.r[PSW] = value; parity(c); return }
	c.write(SFR + address - 128, value)
}
function registerAddress(c: CpuContext, n: number): number { return (c.r[PSW] & 24) + n }
export function readRn(c: CpuContext, n: number): number { return c.read(IRAM + registerAddress(c, n)) }
export function writeRn(c: CpuContext, n: number, value: number): void { c.write(IRAM + registerAddress(c, n), value & 255) }
function carry(c: CpuContext, yes: boolean): void { c.r[PSW] = c.r[PSW] & ~CY | (yes ? CY : 0) }
function bitRead(c: CpuContext, b: number): boolean { return !!(readDirect(c, b < 128 ? 0x20 + (b >>> 3) : b & 0xf8) & 1 << (b & 7)) }
function bitWrite(c: CpuContext, b: number, value: boolean): void { const address = b < 128 ? 0x20 + (b >>> 3) : b & 0xf8; writeDirect(c, address, readDirect(c, address) & ~(1 << (b & 7)) | (value ? 1 << (b & 7) : 0)) }
function push(c: CpuContext, value: number): void { c.r[SP] = c.r[SP] + 1 & 255; c.write(IRAM + c.r[SP], value & 255) }
function pop(c: CpuContext): number { const result = c.read(IRAM + c.r[SP]); c.r[SP] = c.r[SP] - 1 & 255; return result }
function assignA(c: CpuContext, value: number): void { c.r[A] = value & 255; parity(c) }
function readSource(c: CpuContext, code: number, b: number): number { return (code & 15) >= 8 ? readRn(c, code & 7) : (code & 15) >= 6 ? c.read(IRAM + readRn(c, code & 1)) : (code & 15) === 4 ? b : readDirect(c, b) }
function writeDestination(c: CpuContext, code: number, b: number, value: number): void {
	if ((code & 15) >= 8) writeRn(c, code & 7, value)
	else if ((code & 15) >= 6) c.write(IRAM + readRn(c, code & 1), value & 255)
	else writeDirect(c, b, value)
}
function nativeBranch(c: CpuContext, target: number, taken: boolean): void { c.branch(target, taken); if (taken) c.pc = target }
function monitor(c: CpuContext): void {
	switch (c.r[A]) {
		case 0: c.halt(); break
		case 1: c.output(String((readRn(c, 6) << 8 | readRn(c, 7)) << 16 >> 16)); break
		case 2: c.output(String.fromCharCode(readRn(c, 7))); break
		case 3: { const v = c.inputInteger(16); writeRn(c, 6, v >>> 8); writeRn(c, 7, v); break }
		default: throw new Error(`Unknown THRAX 8051 monitor service ${c.r[A]}`)
	}
}
export function decode(memory: Uint8Array, address: number): CpuInstruction {
	const op = memory[address & 65535], b = memory[address + 1 & 65535], d = memory[address + 2 & 65535], word = b << 8 | d
	let size = 1, text = '', call = false, kind: CpuInstruction['kind'] = 'alu'
	const hex = (v: number) => '0x' + v.toString(16), target = (length: number, byte: number) => address + length + (byte << 24 >> 24) & 65535
	const sourceText = (code: number) => (code & 15) >= 8 ? `R${code & 7}` : (code & 15) >= 6 ? `@R${code & 1}` : (code & 15) === 4 ? '#' + hex(b) : hex(b)
	if (op === 0xa5) throw new Error(`Reserved 8051 opcode A5 at ${hex(address)}`)
	if ((op & 31) === 1 || (op & 31) === 17) { size = 2; call = (op & 31) === 17; text = `${call ? 'ACALL' : 'AJMP'} ${hex((address + 2 & 0xf800) | (op & 0xe0) << 3 | b)}` }
	else if (op === 2 || op === 0x12) { size = 3; call = op === 0x12; text = `${call ? 'LCALL' : 'LJMP'} ${hex(word)}` }
	else if ([0x10, 0x20, 0x30].includes(op)) { size = 3; text = `${op === 0x10 ? 'JBC' : op === 0x20 ? 'JB' : 'JNB'} ${hex(b)},${hex(target(3, d))}`; kind = 'branch' }
	else if ([0x40, 0x50, 0x60, 0x70, 0x80].includes(op)) { size = 2; text = `${{ 0x40: 'JC', 0x50: 'JNC', 0x60: 'JZ', 0x70: 'JNZ', 0x80: 'SJMP' }[op]} ${hex(target(2, b))}`; kind = 'branch' }
	else if (op >= 0xb4 && op <= 0xbf) { size = 3; text = `CJNE ${op < 0xb6 ? 'A' : op < 0xb8 ? '@R' + (op & 1) : 'R' + (op & 7)},${op === 0xb5 ? '' : '#'}${hex(b)},${hex(target(3, d))}`; kind = 'branch' }
	else if (op === 0xd5 || op >= 0xd8 && op <= 0xdf) { size = op === 0xd5 ? 3 : 2; text = `DJNZ ${op === 0xd5 ? hex(b) : 'R' + (op & 7)},${hex(target(size, size === 3 ? d : b))}`; kind = 'branch' }
	else if ([0x22, 0x32].includes(op)) { text = op === 0x22 ? 'RET' : 'RETI'; kind = 'return' }
	else if (op === 0) text = 'NOP'
	else if (op === 0x73) { text = 'JMP @A+DPTR'; kind = 'jump' }
	else if (op === 0x90) { size = 3; text = `MOV DPTR,#${hex(word)}` }
	else if (op === 0x83 || op === 0x93) text = `MOVC A,@A+${op === 0x83 ? 'PC' : 'DPTR'}`
	else if ([0xe0, 0xe2, 0xe3, 0xf0, 0xf2, 0xf3].includes(op)) { text = `MOVX ${op < 0xf0 ? 'A,' : ''}${op % 16 ? '@R' + (op & 1) : '@DPTR'}${op >= 0xf0 ? ',A' : ''}`; kind = op < 0xf0 ? 'load' : 'store' }
	else if ([3, 0x13, 0x23, 0x33, 0xc4, 0xd4, 0xe4, 0xf4].includes(op)) text = `${{ 3: 'RR', 0x13: 'RRC', 0x23: 'RL', 0x33: 'RLC', 0xc4: 'SWAP', 0xd4: 'DA', 0xe4: 'CLR', 0xf4: 'CPL' }[op]} A`
	else if (op === 0x84 || op === 0xa4) text = `${op === 0x84 ? 'DIV' : 'MUL'} AB`
	else if (op === 0xa3) text = 'INC DPTR'
	else if ([0xc3, 0xb3, 0xd3].includes(op)) text = `${op === 0xc3 ? 'CLR' : op === 0xb3 ? 'CPL' : 'SETB'} C`
	else if ([0xc2, 0xb2, 0xd2, 0xa2, 0x92, 0x72, 0x82, 0xa0, 0xb0].includes(op)) { size = 2; const n = { 0xc2: 'CLR', 0xb2: 'CPL', 0xd2: 'SETB', 0xa2: 'MOV C,', 0x92: 'MOV', 0x72: 'ORL C,', 0x82: 'ANL C,', 0xa0: 'ORL C,/', 0xb0: 'ANL C,/' }[op]; text = `${n} ${hex(b)}${op === 0x92 ? ',C' : ''}` }
	else if (op === 0xc0 || op === 0xd0) { size = 2; text = `${op === 0xc0 ? 'PUSH' : 'POP'} ${hex(b)}` }
	else if (op >= 4 && op <= 15 || op >= 0x14 && op <= 0x1f) { size = (op & 15) === 5 ? 2 : 1; text = `${op < 0x10 ? 'INC' : 'DEC'} ${(op & 15) === 4 ? 'A' : sourceText(op)}` }
	else if ([0x20, 0x30, 0x40, 0x50, 0x60, 0x90].includes(op & 0xf0) && (op & 15) >= 4) { size = (op & 15) < 6 ? 2 : 1; text = `${{ 0x20: 'ADD', 0x30: 'ADDC', 0x40: 'ORL', 0x50: 'ANL', 0x60: 'XRL', 0x90: 'SUBB' }[op & 0xf0]} A,${sourceText(op)}` }
	else if ([0x42, 0x43, 0x52, 0x53, 0x62, 0x63].includes(op)) { size = op & 1 ? 3 : 2; text = `${{ 0x40: 'ORL', 0x50: 'ANL', 0x60: 'XRL' }[op & 0xf0]} ${hex(b)},${op & 1 ? '#' + hex(d) : 'A'}` }
	else if (op === 0x74) { size = 2; text = `MOV A,#${hex(b)}` }
	else if (op === 0x75) { size = 3; text = `MOV ${hex(b)},#${hex(d)}` }
	else if (op >= 0x76 && op <= 0x7f) { size = 2; text = `MOV ${op < 0x78 ? '@R' + (op & 1) : 'R' + (op & 7)},#${hex(b)}` }
	else if (op === 0x85) { size = 3; text = `MOV ${hex(d)},${hex(b)}` }
	else if (op >= 0x86 && op <= 0x8f) { size = 2; text = `MOV ${hex(b)},${op < 0x88 ? '@R' + (op & 1) : 'R' + (op & 7)}` }
	else if (op >= 0xa6 && op <= 0xaf) { size = 2; text = `MOV ${op < 0xa8 ? '@R' + (op & 1) : 'R' + (op & 7)},${hex(b)}` }
	else if (op >= 0xc5 && op <= 0xcf) { size = op === 0xc5 ? 2 : 1; text = `XCH A,${sourceText(op)}` }
	else if (op === 0xd6 || op === 0xd7) text = `XCHD A,@R${op & 1}`
	else if (op >= 0xe5 && op <= 0xef) { size = op === 0xe5 ? 2 : 1; text = `MOV A,${sourceText(op)}` }
	else if (op >= 0xf5) { size = op === 0xf5 ? 2 : 1; text = `MOV ${sourceText(op)},A` }
	if (!text) throw new Error(`Unsupported 8051 opcode ${hex(op)} at ${hex(address)}`)
	if (call) kind = 'call'
	return { size, text, call, kind, execute(c) {
		const acc = c.r[A], cy = c.r[PSW] & CY ? 1 : 0
		if (call || op === 2 || (op & 31) === 1) {
			const to = op === 2 || op === 0x12 ? word : (c.pc & 0xf800) | (op & 0xe0) << 3 | b
			if (call && to === 0xff00) { monitor(c); return }
			if (call) { push(c, c.pc); push(c, c.pc >>> 8); c.call(to) } else c.pc = to
			return
		}
		if (op === 0x22 || op === 0x32) { const hi = pop(c); c.ret(hi << 8 | pop(c)); return }
		if (op === 0) return
		if ([0x10, 0x20, 0x30].includes(op)) { const yes = bitRead(c, b), take = op === 0x30 ? !yes : yes; if (op === 0x10 && take) bitWrite(c, b, false); nativeBranch(c, target(3, d), take); return }
		if ([0x40, 0x50, 0x60, 0x70, 0x80].includes(op)) { nativeBranch(c, target(2, b), op === 0x80 || op === 0x40 && !!cy || op === 0x50 && !cy || op === 0x60 && !acc || op === 0x70 && !!acc); return }
		if (op >= 0xb4 && op <= 0xbf) { const left = op < 0xb6 ? acc : op < 0xb8 ? c.read(IRAM + readRn(c, op & 1)) : readRn(c, op & 7), right = op === 0xb5 ? readDirect(c, b) : b; carry(c, left < right); nativeBranch(c, target(3, d), left !== right); return }
		if (op === 0xd5 || op >= 0xd8 && op <= 0xdf) { const value = (op === 0xd5 ? readDirect(c, b) : readRn(c, op & 7)) - 1 & 255; if (op === 0xd5) writeDirect(c, b, value); else writeRn(c, op & 7, value); nativeBranch(c, target(size, size === 3 ? d : b), value !== 0); return }
		if (op === 0x73) { c.pc = c.r[DPTR] + acc & 65535; return }
		if (op === 0x90) { c.r[DPTR] = word; return }
		if (op === 0x83 || op === 0x93) { assignA(c, c.read((op === 0x83 ? c.pc : c.r[DPTR]) + acc & 65535)); return }
		if ([0xe0, 0xe2, 0xe3, 0xf0, 0xf2, 0xf3].includes(op)) { const ea = XDATA + (op % 16 ? readDirect(c, 0xa0) << 8 | readRn(c, op & 1) : c.r[DPTR]); if (op < 0xf0) assignA(c, c.read(ea)); else c.write(ea, acc); return }
		if (op === 3) { assignA(c, acc >>> 1 | acc << 7); return }
		if (op === 0x13) { assignA(c, acc >>> 1 | cy << 7); carry(c, !!(acc & 1)); return }
		if (op === 0x23) { assignA(c, acc << 1 | acc >>> 7); return }
		if (op === 0x33) { assignA(c, acc << 1 | cy); carry(c, !!(acc & 128)); return }
		if (op === 0xc4) { assignA(c, acc << 4 | acc >>> 4); return }
		if (op === 0xe4 || op === 0xf4) { assignA(c, op === 0xe4 ? 0 : ~acc); return }
		if (op === 0xd4) { let v = acc; if ((v & 15) > 9 || c.r[PSW] & AC) v += 6; if (v > 0x99 || cy) v += 0x60; if (v > 255) carry(c, true); assignA(c, v); return }
		if (op === 0xa4) { const v = acc * c.r[B]; assignA(c, v); c.r[B] = v >>> 8; c.r[PSW] = c.r[PSW] & ~(CY | OV) | (v > 255 ? OV : 0); return }
		if (op === 0x84) { c.r[PSW] = c.r[PSW] & ~(CY | OV) | (c.r[B] ? 0 : OV); if (c.r[B]) { const divisor = c.r[B]; assignA(c, Math.trunc(acc / divisor)); c.r[B] = acc % divisor } return }
		if (op === 0xa3) { c.r[DPTR] = c.r[DPTR] + 1 & 65535; return }
		if ([0xc3, 0xb3, 0xd3].includes(op)) { carry(c, op === 0xd3 || op === 0xb3 && !cy); return }
		if ([0xc2, 0xb2, 0xd2].includes(op)) { bitWrite(c, b, op === 0xd2 || op === 0xb2 && !bitRead(c, b)); return }
		if (op === 0xa2) { carry(c, bitRead(c, b)); return }
		if (op === 0x92) { bitWrite(c, b, !!cy); return }
		if ([0x72, 0x82, 0xa0, 0xb0].includes(op)) { const value = bitRead(c, b) !== (op === 0xa0 || op === 0xb0); carry(c, op === 0x72 || op === 0xa0 ? !!cy || value : !!cy && value); return }
		if (op === 0xc0) { push(c, readDirect(c, b)); return }
		if (op === 0xd0) { writeDirect(c, b, pop(c)); return }
		if (op >= 4 && op <= 15 || op >= 0x14 && op <= 0x1f) { const value = (op & 15) === 4 ? acc : readSource(c, op, b), result = value + (op < 16 ? 1 : -1); if ((op & 15) === 4) assignA(c, result); else writeDestination(c, op, b, result); return }
		if ([0x20, 0x30, 0x40, 0x50, 0x60, 0x90].includes(op & 0xf0) && (op & 15) >= 4) {
			const value = readSource(c, op, b), group = op & 0xf0
			if (group === 0x40 || group === 0x50 || group === 0x60) { assignA(c, group === 0x40 ? acc | value : group === 0x50 ? acc & value : acc ^ value); return }
			const subtract = group === 0x90, carryIn = group === 0x20 ? 0 : cy, result = subtract ? acc - value - carryIn : acc + value + carryIn
			const aux = subtract ? (acc & 15) < (value & 15) + carryIn : (acc & 15) + (value & 15) + carryIn > 15
			const overflow = !!((subtract ? acc ^ value : ~(acc ^ value)) & (acc ^ result) & 128)
			assignA(c, result); c.r[PSW] = c.r[PSW] & ~(CY | AC | OV) | ((subtract ? result < 0 : result > 255) ? CY : 0) | (aux ? AC : 0) | (overflow ? OV : 0); return
		}
		if ([0x42, 0x43, 0x52, 0x53, 0x62, 0x63].includes(op)) { const left = readDirect(c, b), right = op & 1 ? d : acc; writeDirect(c, b, op < 0x50 ? left | right : op < 0x60 ? left & right : left ^ right); return }
		if (op === 0x74) { assignA(c, b); return }
		if (op === 0x75) { writeDirect(c, b, d); return }
		if (op >= 0x76 && op <= 0x7f) { writeDestination(c, op, b, b); return }
		if (op === 0x85) { writeDirect(c, d, readDirect(c, b)); return }
		if (op >= 0x86 && op <= 0x8f) { writeDirect(c, b, readSource(c, op, b)); return }
		if (op >= 0xa6 && op <= 0xaf) { writeDestination(c, op, b, readDirect(c, b)); return }
		if (op >= 0xc5 && op <= 0xcf) { const value = readSource(c, op, b); writeDestination(c, op, b, acc); assignA(c, value); return }
		if (op === 0xd6 || op === 0xd7) { const ea = IRAM + readRn(c, op & 1), value = c.read(ea); c.write(ea, value & 0xf0 | acc & 15); assignA(c, acc & 0xf0 | value & 15); return }
		if (op >= 0xe5 && op <= 0xef) { assignA(c, readSource(c, op, b)); return }
		if (op >= 0xf5) { writeDestination(c, op, b, acc); return }
		throw new Error(`Unimplemented 8051 opcode ${hex(op)}`)
	} }
}
