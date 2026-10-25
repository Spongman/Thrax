import { htmlReference } from './htmlReferences'
import { instructionHelp, instructionLink } from './instructionHelp'
import { createConfiguredArchitecture } from '../../core/configuredCpu'
import { EXAMPLES } from './examples'
import { historySchema } from './history'
import { A, B, DPTR, SP, PSW, IRAM, SFR, XDATA, decode, encode, instructionSize, instructions, parity, writeRn } from './isa'

export default createConfiguredArchitecture({
	id: 'i8051', name: 'Intel 8051', language: 'i8051', reference: htmlReference,
	registers: [
		{ id: 'a', name: 'A', bank: 'cpu', bits: 8, editable: true },
		{ id: 'b', name: 'B', bank: 'cpu', bits: 8, editable: true },
		{ id: 'dptr', name: 'DPTR', bank: 'cpu', bits: 16, editable: true },
		{ id: 'sp', name: 'SP', bank: 'cpu', bits: 8, editable: true, role: 'stackPointer' },
		{ id: 'psw', name: 'PSW', bank: 'cpu', bits: 8, editable: true, role: 'flags' },
		...Array.from({ length: 8 }, (_, n) => ({ id: `r${n}`, name: `R${n}`, bank: 'cpu', bits: 8, editable: true })),
	],
	pcBits: 16, memoryBytes: 0x30000, textBase: 0x100, dataBase: XDATA, wordBytes: 1, instructionAlignment: 1, littleEndian: false,
	memoryAliases: [
		{ address: SFR + 0x60, register: A, bytes: 1 },
		{ address: SFR + 0x70, register: B, bytes: 1 },
		{ address: SFR + 0x02, register: DPTR, bytes: 2, littleEndian: true },
		{ address: SFR + 0x01, register: SP, bytes: 1 },
		{ address: SFR + 0x50, register: PSW, bytes: 1 },
	],
	memorySections: [
		{ id: 'code', label: 'Code', start: 0, end: 0xffff, code: true },
		{ id: 'iram', label: 'Internal RAM', start: IRAM, end: IRAM + 127 },
		{ id: 'sfr', label: 'Special function registers', start: SFR, end: SFR + 127 },
		{ id: 'xdata', label: 'External data', start: XDATA, end: XDATA + 65535 },
	],
	memoryRegion(address) { if (address < 0x10000) return { start: 0, end: 0xffff }; if (address >= IRAM && address < IRAM + 128) return { start: IRAM, end: IRAM + 127 }; if (address >= SFR && address < SFR + 128) return { start: SFR, end: SFR + 127 }; return address >= XDATA && address < XDATA + 65536 ? { start: XDATA, end: XDATA + 65535 } : null },
	historySchema, instructionHelp, instructionLink, examples: EXAMPLES, instructions, comments: [';'], instructionSize, encode, decode,
	advance(c, size) { c.pc = c.pc + size & 65535 },
	fallThrough(c, size) { return c.pc + size & 65535 },
	fetchAddress(_c, address, offset) { return address + offset & 65535 },
	readRegister(c, n) { return n >= 5 ? c.memory[IRAM + (c.r[PSW] & 24) + n - 5] : c.r[n] },
	writeRegister(c, n, value) { if (n >= 5) writeRn(c, n - 5, Number(value)); else c.r[n] = Number(value) },
	afterEdit: parity,
	reset(c) { c.r[A] = 0; c.r[B] = 0; c.r[DPTR] = 0; c.r[SP] = 7; c.r[PSW] = 0 },
})
