import { integerSyntax, expressionParser, quotedBytes, dataStatements, reservationBytes } from '../../core/assembly/frontend'
import { visitSourceLines, type SourceLine } from '../../core/assembly/sourceLines'
import { integerArithmetic } from '../../core/assembly/integerArithmetic'
import { splitOperands, stripAssemblyComment } from '../../core/assembly/text'
import {
	assembleStatements,
	defaultLimits,
	StatementKind as K,
	type HookContext,
	type Statement
} from '../../core/assembly/assembler'
import { Op, type Arithmetic, type Expr } from '../../core/assembly/expressions'
import type { Position } from '../../core/assembly/tokens'
import { AssemblyError } from '../../core/diagnostics'
import type { AssemblySources } from '../contracts'
import { DATA_BASE, FLOAT_CSRS, fregister, MEMORY_BYTES, register, TEXT_BASE } from './isa'
import { ROUNDING_MODES } from './float'
import { RiscvAssembly } from './program'
import { encodeCompressed } from './compressed'

const arithmetic: Arithmetic = integerArithmetic
const syntax = integerSyntax(Op.Sar, true)
const expression = expressionParser({
	syntax, tokens: /'(?:\\.|[^'\\])'|0[xX][\da-fA-F]+|0[bB][01]+|\d+|[A-Za-z_.$][\w.$]*|<<|>>|[^\s]/g,
	isNumber: part => /^\d|^'/.test(part),
	number: part => part.startsWith("'") ? JSON.parse(`"${part.slice(1, -1)}"`).charCodeAt(0) : Number(part),
})
function checked(v: number, bits: number): number {
	if (!Number.isInteger(v) || v < -(2 ** (bits - 1)) || v >= 2 ** (bits - 1))
		throw new Error(`Immediate ${v} is outside signed ${bits}-bit range`)
	return v
}
function words(...values: number[]): Uint8Array {
	const bytes = new Uint8Array(values.length * 4),
		view = new DataView(bytes.buffer)
	values.forEach((value, i) => view.setUint32(i * 4, value >>> 0, true))
	return bytes
}
const R: Record<string, [number, number]> = {
	add: [0, 0],
	sub: [0, 32],
	sll: [1, 0],
	slt: [2, 0],
	sltu: [3, 0],
	xor: [4, 0],
	srl: [5, 0],
	sra: [5, 32],
	or: [6, 0],
	and: [7, 0],
	mul: [0, 1],
	mulh: [1, 1],
	mulhsu: [2, 1],
	mulhu: [3, 1],
	div: [4, 1],
	divu: [5, 1],
	rem: [6, 1],
	remu: [7, 1]
}
const I: Record<string, number> = { addi: 0, slli: 1, slti: 2, sltiu: 3, xori: 4, srli: 5, srai: 5, ori: 6, andi: 7 }

/** Float operations: base word, operand kinds for rd, rs1, rs2, rs3 ('f' float, 'x' integer), flen, default rounding mode. */
type FloatEncoding = readonly [word: number, operands: string, flen: number, rm?: number]
const FLOAT: Record<string, FloatEncoding> = {
	'fmv.x.w': [0xe0000053, 'xf', 32],
	'fmv.w.x': [0xf0000053, 'fx', 32],
	'fcvt.s.d': [0x40100053, 'ff', 64, 7],
	'fcvt.d.s': [0x42000053, 'ff', 64, 0]
}
for (const [suffix, fmt, flen] of [['s', 0, 32], ['d', 1, 64]] as const) {
	const op = (f5: number, f3 = 0, rs2 = 0) => 0x53 | (f3 << 12) | (rs2 << 20) | (fmt << 25) | (f5 << 27)
	const add = (name: string, word: number, operands: string, rm?: number) => {
		FLOAT[`${name}.${suffix}`] = [word, operands, flen, rm]
	}
	;['fadd', 'fsub', 'fmul', 'fdiv'].forEach((name, i) => add(name, op(i), 'fff', 7))
	;['fmadd', 'fmsub', 'fnmsub', 'fnmadd'].forEach((name, i) => add(name, 0x43 | (i << 2) | (fmt << 25), 'ffff', 7))
	add('fsqrt', op(0x0b), 'ff', 7)
	;['fsgnj', 'fsgnjn', 'fsgnjx'].forEach((name, i) => add(name, op(4, i), 'fff'))
	add('fmin', op(5, 0), 'fff')
	add('fmax', op(5, 1), 'fff')
	;['fle', 'flt', 'feq'].forEach((name, i) => add(name, op(0x14, i), 'xff'))
	add('fcvt.w', op(0x18, 0, 0), 'xf', 7)
	add('fcvt.wu', op(0x18, 0, 1), 'xf', 7)
	// Integer to double is exact, so it encodes RNE by default.
	FLOAT[`fcvt.${suffix}.w`] = [op(0x1a, 0, 0), 'fx', flen, fmt ? 0 : 7]
	FLOAT[`fcvt.${suffix}.wu`] = [op(0x1a, 0, 1), 'fx', flen, fmt ? 0 : 7]
	add('fclass', op(0x1c, 1), 'xf')
}
const FLOAT_ALIASES: Record<string, string> = { 'fmv.x.s': 'fmv.x.w', 'fmv.s.x': 'fmv.w.x' }
/** Register and immediate CSR forms, by funct3. */
const CSR_OPS: Record<string, number> = { csrrw: 1, csrrs: 2, csrrc: 3, csrrwi: 5, csrrsi: 6, csrrci: 7 }
const CSR_READS: Record<string, string> = { frcsr: 'fcsr', frrm: 'frm', frflags: 'fflags' }
const CSR_WRITES: Record<string, string> = { fscsr: 'fcsr', fsrm: 'frm', fsflags: 'fflags', fsrmi: 'frm', fsflagsi: 'fflags' }

/** Minimum flen for a float or CSR mnemonic, 0 for an integer one. */
export function floatRequirement(name: string): number {
	if (!/^(?:f|csr)/.test(name)) return 0
	if (FLOAT[name]) return FLOAT[name][2]
	if (/^f(?:mv|neg|abs)\.[sd]$/.test(name)) return name.endsWith('d') ? 64 : 32
	if (name === 'fld' || name === 'fsd') return 64
	if (FLOAT_ALIASES[name] || name === 'flw' || name === 'fsw' || CSR_READS[name] || CSR_WRITES[name]) return 32
	if (CSR_OPS[name] !== undefined || /^csr(?:r|[wsc]i?)$/.test(name)) return 32
	return 0
}

/** Expand the CSR shorthands to csrrw, csrrs, csrrc and their immediate forms. */
function csrForm(name: string, args: string[]): [string, string[]] | null {
	if (CSR_OPS[name] !== undefined) return [name, args]
	if (CSR_READS[name]) return ['csrrs', [args[0], CSR_READS[name], 'zero', ...args.slice(1)]]
	if (CSR_WRITES[name]) {
		const op = name.endsWith('i') ? 'csrrwi' : 'csrrw'
		return [op, args.length === 1 ? ['zero', CSR_WRITES[name], args[0]] : [args[0], CSR_WRITES[name], ...args.slice(1)]]
	}
	if (name === 'csrr') return ['csrrs', [args[0], args[1], 'zero', ...args.slice(2)]]
	const short = /^csr([wsc])(i?)$/.exec(name)
	if (short) return [`csrr${short[1]}${short[2]}`, ['zero', ...args]]
	return null
}

function encodeFloat(name: string, args: string[], c: HookContext, at: Position): number {
	const need = (count: number) => {
		if (args.length !== count) throw new Error(`${name} expects ${count} operands`)
	}
	const v = (text: string) => c.value(expression(text, at), true)!
	const alias = /^f(mv|neg|abs)\.([sd])$/.exec(name)
	if (alias) {
		need(2)
		args = [args[0], args[1], args[1]]
		name = `fsgnj${({ mv: '', neg: 'n', abs: 'x' } as Record<string, string>)[alias[1]]}.${alias[2]}`
	}
	name = FLOAT_ALIASES[name] ?? name
	if (['flw', 'fld', 'fsw', 'fsd'].includes(name)) {
		need(2)
		const match = /^(.*?)\(([^()]+)\)$/.exec(args[1])
		if (!match) throw new Error('Expected offset(base)')
		const imm = checked(v(match[1] || '0'), 12) & 4095,
			base = register(match[2]),
			data = fregister(args[0]),
			width = name.endsWith('w') ? 2 : 3
		if (name.startsWith('fl')) return 7 | (data << 7) | (width << 12) | (base << 15) | (imm << 20)
		return 0x27 | ((imm & 31) << 7) | (width << 12) | (base << 15) | (data << 20) | ((imm >>> 5) << 25)
	}
	const csr = csrForm(name, args)
	if (csr) {
		const [op, operands] = csr
		if (operands.length !== 3) throw new Error(`${name} has the wrong number of operands`)
		const number = FLOAT_CSRS[operands[1].toLowerCase()] ?? v(operands[1])
		if (!Number.isInteger(number) || number < 0 || number > 4095) throw new Error('CSR number must be 0..4095')
		const f3 = CSR_OPS[op],
			source = f3 > 4 ? v(operands[2]) : register(operands[2])
		if (f3 > 4 && (!Number.isInteger(source) || source < 0 || source > 31)) throw new Error('CSR immediate must be 0..31')
		return 0x73 | (register(operands[0]) << 7) | (f3 << 12) | (source << 15) | (number << 20)
	}
	const [word, operands, , rm] = FLOAT[name]
	let mode = rm
	if (rm !== undefined && args.length === operands.length + 1) {
		mode = ROUNDING_MODES.indexOf(args[args.length - 1].toLowerCase())
		if (mode < 0 || (mode > 4 && mode !== 7)) throw new Error('Rounding mode must be rne, rtz, rdn, rup, rmm or dyn')
		args = args.slice(0, -1)
	}
	need(operands.length)
	let result = word | ((mode ?? 0) << 12)
	operands.split('').forEach((kind, i) => {
		result |= (kind === 'f' ? fregister(args[i]) : register(args[i])) << [7, 15, 20, 27][i]
	})
	return result >>> 0
}

export function encodeInstruction(name: string, args: string[], c: HookContext, at: Position, flen = 0): Uint8Array {
	const required = floatRequirement(name)
	if (required > flen) throw new Error(`${name} requires the ${required === 64 ? 'D' : 'F'} extension`)
	const r = (i: number) => register(args[i] ?? ''),
		v = (i: number) => c.value(expression(args[i] ?? '', at), true)!
	const need = (count: number) => {
		if (args.length !== count) throw new Error(`${name} expects ${count} operands`)
	}
	const iword = (op: number, rd: number, f: number, rs: number, imm: number) =>
		op | (rd << 7) | (f << 12) | (rs << 15) | ((checked(imm, 12) & 4095) << 20)
	if (required) return words(encodeFloat(name, args, c, at))
	if (name === 'nop') {
		need(0)
		return words(0x13)
	}
	if (name === 'ret') {
		need(0)
		return words(0x8067)
	}
	if (name === 'mv' || name === 'not' || name === 'neg') {
		need(2)
		return name === 'neg'
			? words(0x40000033 | (r(0) << 7) | (r(1) << 20))
			: words(iword(0x13, r(0), name === 'not' ? 4 : 0, r(1), name === 'not' ? -1 : 0))
	}
	if (name === 'li' || name === 'la') {
		need(2)
		const value = v(1)
		if (!Number.isInteger(value) || value < -0x80000000 || value > 0xffffffff) throw new Error('32-bit value required')
		const low = (value << 20) >> 20,
			high = ((value - low) / 4096) & 0xfffff
		return words(0x37 | (r(0) << 7) | (high << 12), iword(0x13, r(0), 0, r(0), low))
	}
	if (name === 'ecall' || name === 'ebreak' || name === 'fence') {
		if (name !== 'fence') need(0)
		return words(name === 'ecall' ? 0x73 : name === 'ebreak' ? 0x100073 : 0x0ff0000f)
	}
	if (R[name]) {
		need(3)
		const [f, f7] = R[name]
		return words(0x33 | (r(0) << 7) | (f << 12) | (r(1) << 15) | (r(2) << 20) | (f7 << 25))
	}
	if (I[name] !== undefined) {
		need(3)
		let imm = v(2)
		if (['slli', 'srli', 'srai'].includes(name)) {
			if (imm < 0 || imm > 31 || !Number.isInteger(imm)) throw new Error('Shift amount must be 0..31')
			if (name === 'srai') imm += 1024
		}
		return words(iword(0x13, r(0), I[name], r(1), imm))
	}
	if (name === 'lui' || name === 'auipc') {
		need(2)
		const imm = v(1)
		if (!Number.isInteger(imm) || imm < -524288 || imm > 1048575) throw new Error('20-bit upper immediate required')
		return words((name === 'lui' ? 0x37 : 0x17) | (r(0) << 7) | (imm << 12))
	}
	const loads = ['lb', 'lh', 'lw', '', 'lbu', 'lhu'],
		stores = ['sb', 'sh', 'sw']
	if (loads.includes(name) || stores.includes(name) || name === 'jalr') {
		if (name === 'jalr' && args.length === 3) return words(iword(0x67, r(0), 0, r(1), v(2)))
		need(2)
		const match = /^(.*?)\(([^()]+)\)$/.exec(args[1])
		if (!match) throw new Error('Expected offset(base)')
		const imm = checked(c.value(expression(match[1] || '0', at), true)!, 12),
			base = register(match[2])
		if (stores.includes(name))
			return words(
				0x23 |
					((imm & 31) << 7) |
					(stores.indexOf(name) << 12) |
					(base << 15) |
					(r(0) << 20) |
					(((imm >>> 5) & 127) << 25)
			)
		return words(iword(name === 'jalr' ? 0x67 : 3, r(0), name === 'jalr' ? 0 : loads.indexOf(name), base, imm))
	}
	if (name === 'j' || name === 'call' || name === 'jal') {
		const rd = name === 'j' ? 0 : name === 'call' || args.length === 1 ? 1 : r(0),
			target = v(args.length - 1),
			imm = checked(target - c.dot, 21)
		if (args.length !== (name === 'jal' && args.length === 2 ? 2 : 1)) throw new Error('Invalid jump operands')
		if (imm % 2) throw new Error('Jump offset must be even')
		return words(
			0x6f |
				(rd << 7) |
				(((imm >>> 12) & 255) << 12) |
				(((imm >>> 11) & 1) << 20) |
				(((imm >>> 1) & 1023) << 21) |
				(((imm >>> 20) & 1) << 31)
		)
	}
	if (name === 'beqz' || name === 'bnez') {
		need(2)
		args = [args[0], 'zero', args[1]]
		name = name === 'beqz' ? 'beq' : 'bne'
	}
	const f = ['beq', 'bne', '', '', 'blt', 'bge', 'bltu', 'bgeu'].indexOf(name)
	if (f >= 0) {
		need(3)
		const imm = checked(v(2) - c.dot, 13)
		if (imm % 2) throw new Error('Branch offset must be even')
		return words(
			0x63 |
				(((imm >>> 11) & 1) << 7) |
				(((imm >>> 1) & 15) << 8) |
				(f << 12) |
				(r(0) << 15) |
				(r(1) << 20) |
				(((imm >>> 5) & 63) << 25) |
				(((imm >>> 12) & 1) << 31)
		)
	}
	throw new Error(`Unsupported RV32IM instruction '${name}'`)
}

export function assembleRiscv(sources: AssemblySources, compressed = false, flen = 0): RiscvAssembly {
	const statements: Statement[] = [],
		diagnostics: RiscvAssembly['diagnostics'] = []
	let reservedBytes = 0
	let allowCompressed = compressed
	const reserve = (bytes: number) => {
		reservedBytes += bytes
		if (reservedBytes > MEMORY_BYTES) throw new Error('Assembly exceeds the 1 MiB output limit')
	}
	const visit = ({ text: original, at }: SourceLine): string | undefined => {
		if (diagnostics.length >= 100) return
		if (statements.length > 100000) throw new Error('Expanded source statement limit exceeded')
		try {
			let line = stripAssemblyComment(original, ['#']).trim()
			while (/^[\w.$]+:/.test(line)) {
				if (statements.length >= 100000) throw new Error('Expanded source exceeds 100000 statements')
				const label = /^[\w.$]+/.exec(line)![0]
				statements.push({ kind: K.Label, name: label, at })
				line = line.slice(label.length + 1).trim()
			}
			if (!line) return
			const match = /^(\S+)\s*(.*)$/.exec(line)!,
				op = match[1].toLowerCase(),
				rest = match[2],
				args = splitOperands(rest, { brackets: ['()'], unclosed: 'Unclosed string or operand' })
			if (op === '.include') {
				const included = JSON.parse(rest)
				if (typeof included !== 'string') throw new Error('Expected quoted include path')
				return included
			}
			if (['.globl', '.global', '.type', '.size'].includes(op)) return
			if (op === '.option') {
				if (rest === 'rvc' && compressed) allowCompressed = true
				else if (rest === 'norvc') allowCompressed = false
				else if (!['nopic', 'norelax'].includes(rest))
					throw new Error(`Unsupported .option '${rest}' for the selected instruction set`)
				return
			}
			if (op === '.text' || op === '.data' || op === '.bss' || op === '.section') {
				const section = op === '.section' ? rest.split(',')[0] : op
				if (!['.text', '.data', '.rodata', '.bss'].includes(section))
					throw new Error(`Unsupported section '${section}'`)
				statements.push({ kind: K.Section, section: section === '.text' ? 0 : 1, at })
				return
			}
			if (op === '.equ' || op === '.set') {
				if (args.length !== 2) throw new Error('Expected name, value')
				statements.push({ kind: K.Assign, name: args[0], value: expression(args[1], at), at })
				return
			}
			if (op === '.org') {
				statements.push({ kind: K.Origin, value: expression(rest, at), at })
				return
			}
			if (op === '.align' || op === '.p2align' || op === '.balign') {
				const power = Number(rest)
				if (!Number.isInteger(power) || power < 0 || power > (op === '.balign' ? 4096 : 12))
					throw new Error('Invalid alignment')
				statements.push({ kind: K.Align, boundary: { kind: 0, value: op === '.balign' ? power : 2 ** power }, at })
				return
			}
			if (['.ascii', '.asciz', '.string'].includes(op)) {
				const bytes = quotedBytes(args, op !== '.ascii')
				reserve(bytes.length)
				statements.push({ kind: K.Bytes, bytes, at })
				return
			}
			if (op === '.space' || op === '.zero') {
				const bytes = reservationBytes(Number(args[0]), 1, MEMORY_BYTES, 'Invalid space size')
				reserve(bytes.length)
				statements.push({ kind: K.Bytes, bytes, at })
				return
			}
			if (op === '.float' || op === '.double') {
				const width = op === '.float' ? 4 : 8,
					bytes = new Uint8Array(args.length * width),
					view = new DataView(bytes.buffer)
				args.forEach((arg, i) => {
					const text = arg.toLowerCase().replace(/^([+-]?)inf(?:inity)?$/, '$1Infinity'),
						value = text === 'nan' ? NaN : text ? Number(text) : NaN
					if (Number.isNaN(value) && text !== 'nan') throw new Error(`Invalid floating-point value '${arg}'`)
					if (width === 4) view.setFloat32(i * 4, value, true)
					else view.setFloat64(i * 8, value, true)
				})
				reserve(bytes.length)
				statements.push({ kind: K.Bytes, bytes, at })
				return
			}
			const size = ({ '.byte': 1, '.half': 2, '.2byte': 2, '.word': 4, '.4byte': 4 } as Record<string, number>)[op]
			if (size) {
				for (const statement of dataStatements(args, size, at, expression, reserve, false)) statements.push(statement)
				return
			}
			const short = op.startsWith('c.')
			if (short && !allowCompressed) throw new Error('Compressed instructions require the C extension (RV32IMC) and .option rvc')
			const instructionSize = short ? 2 : op === 'li' || op === 'la' ? 8 : 4
			reserve(instructionSize)
			statements.push({
				kind: K.Fragment,
				size: instructionSize,
				provenance: 'instruction',
				at,
				encode: (c) => {
					try {
						if (c.dot % (compressed ? 2 : 4))
							throw new Error(`Instructions must be aligned to ${compressed ? 'two' : 'four'} bytes`)
						if (short) {
							const half = encodeCompressed(op, args, c.dot, register, (text) => c.value(expression(text, at), true)!, fregister, flen)
							return Uint8Array.of(half & 255, half >>> 8)
						}
						return encodeInstruction(op, args, c, at, flen)
					} catch (error) {
						throw new AssemblyError((error as Error).message, at)
					}
				}
			})
		} catch (error) {
			diagnostics.push({ severity: 'error', message: String((error as Error).message), ...at })
		}
	}
	try {
		visitSourceLines(sources.files, sources.entries[0] ?? sources.files[0]?.name ?? '', { expansions: 4096, depth: 64, lines: 100000 }, visit)
	} catch (error) {
		diagnostics.push(error instanceof AssemblyError ? error.diagnostic : { severity: 'error', message: (error as Error).message })
	}
	if (diagnostics.length) return new RiscvAssembly(sources.entries[0] ?? '', null, diagnostics, compressed, flen)
	const result = assembleStatements(statements, {
		arithmetic,
		checkValue: (v, size, at) => {
			if (!Number.isInteger(v) || v < -(2 ** (size * 8 - 1)) || v >= 2 ** (size * 8))
				throw new AssemblyError('Data value out of range', at)
			return v
		},
		littleEndian: true,
		defaultAlignment: 1,
		originMayDecrease: false,
		entryAddress: TEXT_BASE,
		isInstructionMacro: () => false,
		limits: { ...defaultLimits, addressLimit: MEMORY_BYTES, maxBytes: MEMORY_BYTES },
		sections: [{ start: TEXT_BASE }, { start: DATA_BASE }]
	})
	if (result.image)
		result.image.entryAddress = result.symbols.lookup('_start') ?? result.symbols.lookup('main') ?? TEXT_BASE
	return new RiscvAssembly(sources.entries[0] ?? '', result.image, result.diagnostics, compressed, flen)
}
