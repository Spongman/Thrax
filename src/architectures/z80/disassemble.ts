/**
 * Z80 disassembly in Zilog syntax, decoded by the x/y/z/p/q fields of each
 * opcode. Numbers are hex with a `$`; a relative jump shows its target.
 */

const R = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A']
const RP = ['BC', 'DE', 'HL', 'SP']
const RP2 = ['BC', 'DE', 'HL', 'AF']
const CC = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M']
const ALU = ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP ']
const ROT = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL']
const ACC = ['RLCA', 'RRCA', 'RLA', 'RRA', 'DAA', 'CPL', 'SCF', 'CCF']
const IM = ['0', '0', '1', '2', '0', '0', '1', '2']
const BLOCK = [
	['LDI', 'CPI', 'INI', 'OUTI'],
	['LDD', 'CPD', 'IND', 'OUTD'],
	['LDIR', 'CPIR', 'INIR', 'OTIR'],
	['LDDR', 'CPDR', 'INDR', 'OTDR'],
]

export const hex8 = (value: number) => `$${(value & 0xFF).toString(16).toUpperCase().padStart(2, '0')}`
export const hex16 = (value: number) => `$${(value & 0xFFFF).toString(16).toUpperCase().padStart(4, '0')}`

export interface Decoded {
	text: string
	/** Bytes the instruction takes, prefixes included: 1 to 4. */
	length: number
}

/** Reads the byte `offset` bytes into the instruction. */
export type ByteReader = (offset: number) => number

/** Decodes the instruction whose first byte `read(0)` gives, at `address`. */
export function decode(read: ByteReader, address: number): Decoded {
	let at = 0
	const next = () => read(at++) & 0xFF
	const word = () => {
		const low = next()
		return low | (next() << 8)
	}
	let index = ''
	let opcode = next()
	while (opcode === 0xDD || opcode === 0xFD) {
		index = opcode === 0xDD ? 'IX' : 'IY'
		opcode = next()
	}
	// An index prefix turns HL into IX, H and L into IXH and IXL, and (HL) into (IX+d).
	let displacement: string | null = null
	const memory = () => {
		if (!index) return '(HL)'
		if (displacement === null) {
			const offset = (next() << 24) >> 24
			displacement = `(${index}${offset < 0 ? '-' : '+'}${hex8(Math.abs(offset))})`
		}
		return displacement
	}
	const reg = (code: number, plain = false) => {
		if (code === 6) return memory()
		if (index && !plain && (code === 4 || code === 5)) return index + (code === 4 ? 'H' : 'L')
		return R[code]
	}
	const pair = (name: string) => name === 'HL' && index ? index : name
	const done = (text: string): Decoded => ({ text, length: at })

	if (opcode === 0xCB) {
		if (index) {
			const target = memory()
			const op = next()
			const y = (op >> 3) & 7
			const z = op & 7
			const copy = z === 6 ? '' : `,${R[z]}`
			switch (op >> 6) {
				case 0: return done(`${ROT[y]} ${target}${copy}`)
				case 1: return done(`BIT ${y},${target}`)
				case 2: return done(`RES ${y},${target}${copy}`)
				default: return done(`SET ${y},${target}${copy}`)
			}
		}
		const op = next()
		const y = (op >> 3) & 7
		const operand = R[op & 7]
		switch (op >> 6) {
			case 0: return done(`${ROT[y]} ${operand}`)
			case 1: return done(`BIT ${y},${operand}`)
			case 2: return done(`RES ${y},${operand}`)
			default: return done(`SET ${y},${operand}`)
		}
	}

	if (opcode === 0xED) {
		const op = next()
		const x = op >> 6
		const y = (op >> 3) & 7
		const z = op & 7
		const p = y >> 1
		const q = y & 1
		if (x === 2 && z <= 3 && y >= 4) return done(BLOCK[y - 4][z])
		if (x !== 1) return done(`DB $ED,${hex8(op)}`)
		switch (z) {
			case 0: return done(y === 6 ? 'IN F,(C)' : `IN ${R[y]},(C)`)
			case 1: return done(y === 6 ? 'OUT (C),0' : `OUT (C),${R[y]}`)
			case 2: return done(`${q === 0 ? 'SBC' : 'ADC'} HL,${RP[p]}`)
			case 3: {
				const value = hex16(word())
				return done(q === 0 ? `LD (${value}),${RP[p]}` : `LD ${RP[p]},(${value})`)
			}
			case 4: return done('NEG')
			case 5: return done(y === 1 ? 'RETI' : 'RETN')
			case 6: return done(`IM ${IM[y]}`)
			default: return done(['LD I,A', 'LD R,A', 'LD A,I', 'LD A,R', 'RRD', 'RLD', 'NOP', 'NOP'][y])
		}
	}

	const x = opcode >> 6
	const y = (opcode >> 3) & 7
	const z = opcode & 7
	const p = y >> 1
	const q = y & 1
	const relative = () => {
		const offset = (next() << 24) >> 24
		return hex16(address + at + offset)
	}
	switch (x) {
		case 0:
			switch (z) {
				case 0:
					switch (y) {
						case 0: return done('NOP')
						case 1: return done('EX AF,AF\'')
						case 2: return done(`DJNZ ${relative()}`)
						case 3: return done(`JR ${relative()}`)
						default: return done(`JR ${CC[y - 4]},${relative()}`)
					}
				case 1:
					if (q === 0) return done(`LD ${pair(RP[p])},${hex16(word())}`)
					return done(`ADD ${pair('HL')},${pair(RP[p])}`)
				case 2:
					switch (y) {
						case 0: return done('LD (BC),A')
						case 1: return done('LD A,(BC)')
						case 2: return done('LD (DE),A')
						case 3: return done('LD A,(DE)')
						case 4: return done(`LD (${hex16(word())}),${pair('HL')}`)
						case 5: return done(`LD ${pair('HL')},(${hex16(word())})`)
						case 6: return done(`LD (${hex16(word())}),A`)
						default: return done(`LD A,(${hex16(word())})`)
					}
				case 3: return done(`${q === 0 ? 'INC' : 'DEC'} ${pair(RP[p])}`)
				case 4: return done(`INC ${reg(y)}`)
				case 5: return done(`DEC ${reg(y)}`)
				case 6: {
					const target = reg(y)
					return done(`LD ${target},${hex8(next())}`)
				}
				default: return done(ACC[y])
			}
		case 1: {
			if (opcode === 0x76) return done('HALT')
			const memoryOperand = y === 6 || z === 6
			const target = reg(y, memoryOperand)
			return done(`LD ${target},${reg(z, memoryOperand)}`)
		}
		case 2: return done(`${ALU[y]}${reg(z)}`)
		default:
			switch (z) {
				case 0: return done(`RET ${CC[y]}`)
				case 1:
					if (q === 0) return done(`POP ${pair(RP2[p])}`)
					return done(['RET', 'EXX', `JP (${pair('HL')})`, `LD SP,${pair('HL')}`][p])
				case 2: return done(`JP ${CC[y]},${hex16(word())}`)
				case 3:
					switch (y) {
						case 0: return done(`JP ${hex16(word())}`)
						case 2: return done(`OUT (${hex8(next())}),A`)
						case 3: return done(`IN A,(${hex8(next())})`)
						case 4: return done(`EX (SP),${pair('HL')}`)
						case 5: return done('EX DE,HL')
						case 6: return done('DI')
						default: return done('EI')
					}
				case 4: return done(`CALL ${CC[y]},${hex16(word())}`)
				case 5:
					if (q === 0) return done(`PUSH ${pair(RP2[p])}`)
					return done(`CALL ${hex16(word())}`)
				case 6: return done(`${ALU[y]}${hex8(next())}`)
				default: return done(`RST ${hex8(y * 8)}`)
			}
	}
}

/** Bytes the instruction at `read(0)` takes, without building its text. */
export function instructionLength(read: ByteReader): number {
	let at = 0
	let opcode = read(at++) & 0xFF
	let indexed = false
	while ((opcode === 0xDD || opcode === 0xFD) && at < 4) {
		indexed = true
		opcode = read(at++) & 0xFF
	}
	if (opcode === 0xCB) return at + (indexed ? 2 : 1)
	if (opcode === 0xED) {
		const next = read(at) & 0xFF
		return at + ((next & 0xC7) === 0x43 ? 3 : 1)
	}
	const x = opcode >> 6
	const y = (opcode >> 3) & 7
	const z = opcode & 7
	// (IX+d) takes a displacement byte.
	const displaced = indexed ? 1 : 0
	switch (x) {
		case 0:
			switch (z) {
				case 0: return at + (y >= 2 ? 1 : 0)
				case 1: return at + ((y & 1) === 0 ? 2 : 0)
				case 2: return at + (y >= 4 ? 2 : 0)
				case 4:
				case 5: return at + (y === 6 ? displaced : 0)
				case 6: return at + 1 + (y === 6 ? displaced : 0)
				default: return at
			}
		case 1: return at + (opcode !== 0x76 && (y === 6 || z === 6) ? displaced : 0)
		case 2: return at + (z === 6 ? displaced : 0)
		default:
			switch (z) {
				case 2:
				case 4: return at + 2
				case 3: return at + (y === 0 ? 2 : y === 2 || y === 3 ? 1 : 0)
				case 5: return at + (y === 1 ? 2 : 0)
				case 6: return at + 1
				default: return at
			}
	}
}

/** The instruction in `bytes`, which start at `address`; missing bytes read as zero. */
export function disassembleBytes(bytes: ArrayLike<number>, address: number): Decoded {
	return decode((offset) => bytes[offset] ?? 0, address)
}
