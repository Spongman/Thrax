import {
	assembleStatements,
	defaultLimits,
	StatementKind as K,
	type HookContext,
	type Statement
} from '../../core/assembly/assembler'
import { Op, parseExpression, type Arithmetic, type Expr } from '../../core/assembly/expressions'
import { makeToken, TokenCursor, TokenKind, type Position } from '../../core/assembly/tokens'
import { AssemblyError } from '../../core/diagnostics'
import type { AssemblySources } from '../contracts'
import { DATA_BASE, MEMORY_BYTES, register, TEXT_BASE } from './isa'
import { RiscvAssembly } from './program'
import { encodeCompressed } from './compressed'

const arithmetic: Arithmetic = {
	unary: (op, v) => (op === Op.Neg ? -v : op === Op.Not ? ~v : v),
	binary(op, a, b, at) {
		switch (op) {
			case Op.Add:
				return a + b
			case Op.Sub:
				return a - b
			case Op.Mul:
				return a * b
			case Op.Div:
				if (b === 0) throw new AssemblyError('Division by zero', at)
				return Math.trunc(a / b)
			case Op.Mod:
				if (b === 0) throw new AssemblyError('Division by zero', at)
				return a % b
			case Op.And:
				return a & b
			case Op.Or:
				return a | b
			case Op.Xor:
				return a ^ b
			case Op.Shl:
				return a << b
			default:
				return a >> b
		}
	}
}
const syntax = {
	binary: new Map([
		['|', { op: Op.Or, precedence: 1 }],
		['^', { op: Op.Xor, precedence: 2 }],
		['&', { op: Op.And, precedence: 3 }],
		['<<', { op: Op.Shl, precedence: 4 }],
		['>>', { op: Op.Sar, precedence: 4 }],
		['+', { op: Op.Add, precedence: 5 }],
		['-', { op: Op.Sub, precedence: 5 }],
		['*', { op: Op.Mul, precedence: 6 }],
		['/', { op: Op.Div, precedence: 6 }],
		['%', { op: Op.Mod, precedence: 6 }]
	]),
	unary: new Map([
		['-', Op.Neg],
		['+', Op.Plus],
		['~', Op.Not]
	]),
	dot: '.'
}
function expression(text: string, at: Position): Expr {
	const parts = text.match(/'(?:\\.|[^'\\])'|0[xX][\da-fA-F]+|0[bB][01]+|\d+|[A-Za-z_.$][\w.$]*|<<|>>|[^\s]/g) ?? []
	const tokens = parts.map((p) => {
		const numeric = /^\d|^'/.test(p)
		const token = makeToken(
			numeric ? TokenKind.Number : /^[\w.$]/.test(p) ? TokenKind.Identifier : TokenKind.Operator,
			p,
			at.file,
			at.line,
			1
		)
		token.value = p.startsWith("'") ? JSON.parse(`"${p.slice(1, -1)}"`).charCodeAt(0) : Number(p)
		return token
	})
	const cursor = new TokenCursor(tokens),
		expr = parseExpression(cursor, syntax)
	if (!expr || !cursor.atEnd()) throw new AssemblyError(`Invalid expression '${text}'`, at)
	return expr
}
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
export function encodeInstruction(name: string, args: string[], c: HookContext, at: Position): Uint8Array {
	const r = (i: number) => register(args[i] ?? ''),
		v = (i: number) => c.value(expression(args[i] ?? '', at), true)!
	const need = (count: number) => {
		if (args.length !== count) throw new Error(`${name} expects ${count} operands`)
	}
	const iword = (op: number, rd: number, f: number, rs: number, imm: number) =>
		op | (rd << 7) | (f << 12) | (rs << 15) | ((checked(imm, 12) & 4095) << 20)
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

export function assembleRiscv(sources: AssemblySources, compressed = false): RiscvAssembly {
	const statements: Statement[] = [],
		diagnostics: RiscvAssembly['diagnostics'] = [],
		files = new Map(sources.files.map((f) => [f.name, f]))
	let reservedBytes = 0
	let allowCompressed = compressed
	const reserve = (bytes: number) => {
		reservedBytes += bytes
		if (reservedBytes > MEMORY_BYTES) throw new Error('Assembly exceeds the 1 MiB output limit')
	}
	let visitedLines = 0,
		expansions = 0
	const visit = (name: string, chain: string[]) => {
		if (chain.includes(name) || chain.length >= 64) throw new Error(`Recursive include '${name}'`)
		if (++expansions > 4096) throw new Error('Source include expansion limit exceeded')
		const file = files.get(name)
		if (!file) throw new Error(`File '${name}' not found`)
		for (const [index, original] of file.code.split(/\r?\n/).entries()) {
			if (diagnostics.length >= 100) return
			if (statements.length > 100000) throw new Error('Expanded source exceeds 100000 statements')
			if (++visitedLines > 100000) throw new Error('Expanded source exceeds 100000 lines')
			const at = { file: name, line: index + 1, column: 1 }
			try {
				let line = original.replace(/#(?=(?:[^"\\]*(?:\\.[^"\\]*)*"[^"\\]*(?:\\.[^"\\]*)*")*[^"\\]*$).*$/, '').trim()
				while (/^[\w.$]+:/.test(line)) {
					if (statements.length >= 100000) throw new Error('Expanded source exceeds 100000 statements')
					const label = /^[\w.$]+/.exec(line)![0]
					statements.push({ kind: K.Label, name: label, at })
					line = line.slice(label.length + 1).trim()
				}
				if (!line) continue
				const match = /^(\S+)\s*(.*)$/.exec(line)!,
					op = match[1].toLowerCase(),
					rest = match[2],
					args = rest ? rest.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.trim()) : []
				if (op === '.include') {
					const included = JSON.parse(rest)
					const relative = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) + included : included
					visit(files.has(relative) ? relative : included, [...chain, name])
					continue
				}
				if (['.globl', '.global', '.type', '.size'].includes(op)) continue
				if (op === '.option') {
					if (rest === 'rvc' && compressed) allowCompressed = true
					else if (rest === 'norvc') allowCompressed = false
					else if (!['nopic', 'norelax'].includes(rest))
						throw new Error(`Unsupported .option '${rest}' for the selected instruction set`)
					continue
				}
				if (op === '.text' || op === '.data' || op === '.bss' || op === '.section') {
					const section = op === '.section' ? rest.split(',')[0] : op
					if (!['.text', '.data', '.rodata', '.bss'].includes(section))
						throw new Error(`Unsupported section '${section}'`)
					statements.push({ kind: K.Section, section: section === '.text' ? 0 : 1, at })
					continue
				}
				if (op === '.equ' || op === '.set') {
					if (args.length !== 2) throw new Error('Expected name, value')
					statements.push({ kind: K.Assign, name: args[0], value: expression(args[1], at), at })
					continue
				}
				if (op === '.org') {
					statements.push({ kind: K.Origin, value: expression(rest, at), at })
					continue
				}
				if (op === '.align' || op === '.p2align' || op === '.balign') {
					const power = Number(rest)
					if (!Number.isInteger(power) || power < 0 || power > (op === '.balign' ? 4096 : 12))
						throw new Error('Invalid alignment')
					statements.push({ kind: K.Align, boundary: { kind: 0, value: op === '.balign' ? power : 2 ** power }, at })
					continue
				}
				if (['.ascii', '.asciz', '.string'].includes(op)) {
					const string = args.map((a) => JSON.parse(a)).join('')
					if (typeof string !== 'string') throw new Error('Expected quoted string')
					const bytes = new TextEncoder().encode(string + (op === '.ascii' ? '' : '\0'))
					reserve(bytes.length)
					statements.push({ kind: K.Bytes, bytes, at })
					continue
				}
				if (op === '.space' || op === '.zero') {
					const count = Number(args[0])
					if (!Number.isInteger(count) || count < 0 || count > MEMORY_BYTES) throw new Error('Invalid space size')
					reserve(count)
					statements.push({ kind: K.Bytes, bytes: new Uint8Array(count), at })
					continue
				}
				const size = ({ '.byte': 1, '.half': 2, '.2byte': 2, '.word': 4, '.4byte': 4 } as Record<string, number>)[op]
				if (size) {
					reserve(size * args.length)
					for (const arg of args) statements.push({ kind: K.Emit, size, value: expression(arg, at), at })
					continue
				}
				const short = op.startsWith('c.')
				if (short && !allowCompressed) throw new Error('Compressed instructions require RV32IMC and .option rvc')
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
								const half = encodeCompressed(op, args, c.dot, register, (text) => c.value(expression(text, at), true)!)
								return Uint8Array.of(half & 255, half >>> 8)
							}
							return encodeInstruction(op, args, c, at)
						} catch (error) {
							throw new AssemblyError((error as Error).message, at)
						}
					}
				})
			} catch (error) {
				diagnostics.push({ severity: 'error', message: String((error as Error).message), ...at })
			}
		}
	}
	try {
		visit(sources.entries[0] ?? sources.files[0]?.name ?? '', [])
	} catch (error) {
		diagnostics.push({ severity: 'error', message: (error as Error).message })
	}
	if (diagnostics.length) return new RiscvAssembly(sources.entries[0] ?? '', null, diagnostics, compressed)
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
	return new RiscvAssembly(sources.entries[0] ?? '', result.image, result.diagnostics, compressed)
}
