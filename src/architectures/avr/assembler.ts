import {
	assembleStatements,
	defaultLimits,
	StatementKind as S,
	type Statement,
	type HookContext
} from '../../core/assembly/assembler'
import {
	parseExpression,
	Op,
	type Expr,
	type Arithmetic,
	type ExpressionSyntax
} from '../../core/assembly/expressions'
import { expandSources } from '../../core/assembly/sources'
import {
	makeToken,
	TokenCursor,
	TokenKind as T,
	type Position,
	type Token
} from '../../core/assembly/tokens'
import { AssemblyError } from '../../core/diagnostics'
import type { AssemblySources, Diagnostic } from '../contracts'
import { BRANCH, FIXED, IMM, RR, SINGLE } from './isa'

const syntax: ExpressionSyntax = {
	binary: new Map([
		['|', { op: Op.Or, precedence: 1 }],
		['^', { op: Op.Xor, precedence: 2 }],
		['&', { op: Op.And, precedence: 3 }],
		['<<', { op: Op.Shl, precedence: 4 }],
		['>>', { op: Op.Shr, precedence: 4 }],
		['+', { op: Op.Add, precedence: 5 }],
		['-', { op: Op.Sub, precedence: 5 }],
		['*', { op: Op.Mul, precedence: 6 }],
		['/', { op: Op.Div, precedence: 6 }]
	]),
	unary: new Map([
		['-', Op.Neg],
		['+', Op.Plus],
		['~', Op.Not],
		['lo8', 100],
		['hi8', 101],
		['low', 100],
		['high', 101]
	]),
	dot: '.'
}
const arithmetic: Arithmetic = {
	unary: (op, value) =>
		op === Op.Neg
			? -value
			: op === Op.Not
				? ~value
				: op === 100
					? value & 255
					: op === 101
						? (value >> 8) & 255
						: value,
	binary(op, a, b, at) {
		switch (op) {
			case Op.Add:
				return a + b
			case Op.Sub:
				return a - b
			case Op.Mul:
				return a * b
			case Op.Div:
				if (!b) throw new AssemblyError('Division by zero', at)
				return Math.trunc(a / b)
			case Op.And:
				return a & b
			case Op.Or:
				return a | b
			case Op.Xor:
				return a ^ b
			case Op.Shl:
				return a << b
			case Op.Shr:
				return a >> b
		}
		throw new AssemblyError('Unsupported operator', at)
	}
}
const number = (value: number): Expr => ({ kind: 0, value })
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key)
function withoutComment(text: string) {
	let quote = ''
	for (let index = 0; index < text.length; index++) {
		const character = text[index]
		if (quote && character === '\\') {
			index++
			continue
		}
		if (character === quote) quote = ''
		else if (!quote && (character === "'" || character === '"')) quote = character
		else if (!quote && character === ';') return text.slice(0, index).trim()
	}
	return text.trim()
}
function expression(text: string, at: Position): Expr {
	const tokens: Token[] = []
	const re = /\s+|0x[\da-f]+|0b[01]+|\d+|'(?:[^'\\]|\\.)'|[A-Za-z_.$][\w.$]*|<<|>>|./gi
	for (const match of text.matchAll(re)) {
		const value = match[0]
		if (/^\s+$/.test(value)) continue
		const numeric = /^(?:\d|')/.test(value)
		const unary = syntax.unary.has(value.toLowerCase())
		const token = makeToken(
			numeric ? T.Number : unary || !/^[A-Za-z_.$]/.test(value) ? T.Operator : T.Identifier,
			unary ? value.toLowerCase() : value,
			at.file,
			at.line,
			at.column + match.index!
		)
		if (numeric)
			token.value = value.startsWith("'")
				? value[1] === '\\'
					? ({ n: 10, r: 13, t: 9 }[value[2]] ?? value.charCodeAt(2))
					: value.charCodeAt(1)
				: Number(value)
		tokens.push(token)
	}
	const cursor = new TokenCursor(tokens)
	const result = parseExpression(cursor, syntax)
	if (!result || !cursor.atEnd()) throw new AssemblyError(`Invalid expression '${text}'`, at)
	return result
}
const range = (value: number, lo: number, hi: number, at: Position) => {
	if (!Number.isInteger(value) || value < lo || value > hi)
		throw new AssemblyError(`Value ${value} is outside ${lo}..${hi}`, at)
	return value
}
function encode(name: string, args: string[], context: HookContext, at: Position): number[] {
	const count = (n: number) => {
		if (args.length !== n) throw new AssemblyError(`${name} expects ${n} operands`, at)
	}
	const reg = (i: number, high = false) => {
		if (!/^r\d+$/i.test(args[i] ?? '')) throw new AssemblyError('Expected register r0..r31', at)
		return range(Number(args[i].slice(1)), high ? 16 : 0, 31, at)
	}
	const val = (i: number, lo = 0, hi = 255) =>
		range(context.value(expression(args[i] ?? '', at), true)!, lo, hi, at)
	const rr = (base: number, d: number, r: number) => base | (d << 4) | (r & 15) | ((r & 16) << 5)
	let word: number
	let extra: number | undefined
	if (['clr', 'tst', 'lsl', 'rol'].includes(name)) {
		count(1)
		const d = reg(0)
		word = rr(RR[{ clr: 'eor', tst: 'and', lsl: 'add', rol: 'adc' }[name]!], d, d)
	} else if (name === 'ser') {
		count(1)
		word = 0xef0f | ((reg(0, true) - 16) << 4)
	} else if (['sec', 'clc', 'sei', 'cli'].includes(name)) {
		count(0)
		word = (name.startsWith('cl') ? 0x9488 : 0x9408) | ((name.endsWith('i') ? 7 : 0) << 4)
	} else if (own(FIXED, name)) {
		count(0)
		word = FIXED[name]
	} else if (own(RR, name)) {
		count(2)
		word = rr(RR[name], reg(0), reg(1))
	} else if (own(IMM, name)) {
		count(2)
		const k = val(1)
		word = IMM[name] | ((reg(0, true) - 16) << 4) | (k & 15) | ((k & 240) << 4)
	} else if (own(SINGLE, name)) {
		count(1)
		word = SINGLE[name] | (reg(0) << 4)
	} else if (name === 'rjmp' || name === 'rcall' || own(BRANCH, name)) {
		count(1)
		const target = val(0, 0, 65535)
		const branch = own(BRANCH, name)
		const offset = range(
			(target - context.dot - 2) / 2,
			branch ? -64 : -2048,
			branch ? 63 : 2047,
			at
		)
		word = branch
			? (BRANCH[name] >= 8 ? 0xf400 : 0xf000) | ((offset & 127) << 3) | (BRANCH[name] & 7)
			: (name === 'rcall' ? 0xd000 : 0xc000) | (offset & 4095)
	} else if (name === 'jmp' || name === 'call') {
		count(1)
		word = name === 'call' ? 0x940e : 0x940c
		extra = range(val(0, 0, 65535) / 2, 0, 32767, at)
	} else if (name === 'lds' || name === 'sts') {
		count(2)
		word = (name === 'lds' ? 0x9000 : 0x9200) | (reg(name === 'lds' ? 0 : 1) << 4)
		extra = val(name === 'lds' ? 1 : 0, 0, 65535)
	} else if (name === 'in' || name === 'out') {
		count(2)
		const k = val(name === 'in' ? 1 : 0, 0, 63)
		word =
			(name === 'in' ? 0xb000 : 0xb800) |
			(reg(name === 'in' ? 0 : 1) << 4) |
			(k & 15) |
			((k & 48) << 5)
	} else if (name === 'bset' || name === 'bclr') {
		count(1)
		word = (name === 'bset' ? 0x9408 : 0x9488) | (val(0, 0, 7) << 4)
	} else if (['sbrc', 'sbrs', 'bst', 'bld'].includes(name)) {
		count(2)
		word =
			{ sbrc: 0xfc00, sbrs: 0xfe00, bst: 0xfa00, bld: 0xf800 }[name]! | (reg(0) << 4) | val(1, 0, 7)
	} else if (name === 'ld' || name === 'st') {
		count(2)
		const pointer = args[name === 'ld' ? 1 : 0].toUpperCase()
		const codes: Record<string, number> = {
			X: 0x900c,
			'X+': 0x900d,
			'-X': 0x900e,
			Y: 0x8008,
			'Y+': 0x9009,
			'-Y': 0x900a,
			Z: 0x8000,
			'Z+': 0x9001,
			'-Z': 0x9002
		}
		if (!own(codes, pointer))
			throw new AssemblyError('Expected X, Y, Z, postincrement or predecrement pointer', at)
		const d = reg(name === 'ld' ? 0 : 1)
		const pair = pointer.includes('X') ? 26 : pointer.includes('Y') ? 28 : 30
		if (pointer !== pointer.replace(/[+-]/g, '') && (d === pair || d === pair + 1))
			throw new AssemblyError('Register overlaps modified pointer (undefined on AVR)', at)
		word = codes[pointer] | (name === 'st' ? 0x200 : 0) | (d << 4)
	} else throw new AssemblyError(`Unsupported AVR instruction '${name}'`, at)
	return extra === undefined
		? [word & 255, word >> 8]
		: [word & 255, word >> 8, extra & 255, extra >> 8]
}

export function assembleAvr({ files, entries }: AssemblySources) {
	const diagnostics: Diagnostic[] = []
	const statements: Statement[] = []
	const dataLabels = new Set<string>()
	const main = files.find((file) => file.name === entries[0]) ??
		files[0] ?? { name: 'main.asm', code: '' }
	let data = false
	try {
		const lines = expandSources<{ text: string; at: Position }>([main], {
			tokenize: (source) =>
				source.code.split('\n').map((text, index) => ({
					text: withoutComment(text),
					at: { file: source.name, line: index + 1, column: 1 }
				})),
			readInclude: (stream, index) => {
				const m = /^\.include\s+"([^"]+)"$/i.exec(stream[index].text)
				return m ? { name: m[1], nextIndex: index + 1 } : null
			},
			resolve: (name, from, token) => {
				const path = from.name.slice(0, from.name.lastIndexOf('/') + 1) + name
				const file = files.find((file) => file.name === path || file.name === name)
				if (!file) throw new AssemblyError(`Include file not found: ${name}`, token.at)
				return file
			},
			boundary: () => [],
			identity: (source) => source.name,
			includeOnce: false,
			maxFileExpansions: 256,
			cycle: (source, _chain, token) =>
				new AssemblyError(`Recursive include: ${source.name}`, token?.at),
			limit: (source) => new AssemblyError(`Include limit reached: ${source.name}`)
		})
		for (const line of lines) {
			const at = line.at
			let text = line.text
			const label = /^([A-Za-z_.$][\w.$]*):/.exec(text)
			if (label) {
				if (data) dataLabels.add(label[1])
				statements.push(
					data
						? {
								kind: S.Assign,
								name: label[1],
								value: { kind: 4, op: Op.Sub, left: { kind: 2 }, right: number(65536), at },
								at
							}
						: { kind: S.Label, name: label[1], at }
				)
				text = text.slice(label[0].length).trim()
			}
			if (!text) continue
			const match = /^(\S+)(?:\s+(.*))?$/.exec(text)!
			const name = match[1].toLowerCase()
			const tail = match[2] ?? ''
			const args = tail ? tail.split(',').map((arg) => arg.trim()) : []
			if (name === '.cseg' || name === '.text' || name === '.dseg' || name === '.data') {
				data = name === '.dseg' || name === '.data'
				statements.push({ kind: S.Section, section: data ? 1 : 0, at })
				continue
			}
			if (name === '.org') {
				const value = expression(tail, at)
				statements.push({
					kind: S.Origin,
					value: data ? { kind: 4, op: Op.Add, left: value, right: number(65536), at } : value,
					at
				})
				continue
			}
			if (name === '.equ' || name === '.set') {
				const assign = /^(\w+)\s*(?:,|=)\s*(.+)$/.exec(tail)
				if (!assign) throw new AssemblyError('Expected .equ name, expression', at)
				statements.push({ kind: S.Assign, name: assign[1], value: expression(assign[2], at), at })
				continue
			}
			if (name === '.byte' || name === '.db' || name === '.word' || name === '.dw') {
				for (const arg of args)
					statements.push({
						kind: S.Emit,
						value: expression(arg, at),
						size: name === '.word' || name === '.dw' ? 2 : 1,
						at
					})
				continue
			}
			if (name.startsWith('.')) throw new AssemblyError(`Unsupported AVR directive '${name}'`, at)
			if (data) throw new AssemblyError('Instructions must be in .text/.cseg', at)
			statements.push({
				kind: S.Fragment,
				size: ['jmp', 'call', 'lds', 'sts'].includes(name) ? 4 : 2,
				provenance: 'instruction',
				at,
				encode(context) {
					if (context.dot % 2 || context.dot >= 65536)
						throw new AssemblyError('AVR instructions require even byte addresses within flash', at)
					return encode(name, args, context, at)
				}
			})
		}
	} catch (error) {
		if (!(error instanceof AssemblyError)) throw error
		diagnostics.push(error.diagnostic)
	}
	if (diagnostics.length) return { image: null, diagnostics }
	const outcome = assembleStatements(statements, {
		arithmetic,
		littleEndian: true,
		defaultAlignment: 1,
		originMayDecrease: true,
		entryAddress: null,
		isInstructionMacro: () => false,
		limits: { ...defaultLimits, addressLimit: 131072, maxBytes: 131072 },
		sections: [{ start: 0 }, { start: 0x10100 }],
		checkValue: (value, size, at) => range(value, -(2 ** (size * 8 - 1)), 2 ** (size * 8) - 1, at)
	})
	if (outcome.image) {
		outcome.image = {
			...outcome.image,
			symbols: [
				...outcome.image.symbols,
				...Array.from(dataLabels, (name) => ({
					name,
					address: outcome.symbols.lookup(name)! + 65536
				}))
			]
		}
		for (const section of outcome.image.sections)
			if (section.address >= 65536 && section.address < 0x10100)
				return {
					image: null,
					diagnostics: [
						{
							severity: 'error' as const,
							message: 'Initialized AVR data must be in SRAM at address 0x100 or above'
						}
					]
				}
		for (const section of outcome.image.sections)
			if (section.address < 65536 && section.address + section.bytes.length > 65536)
				return {
					image: null,
					diagnostics: [
						{ severity: 'error' as const, message: 'AVR section crosses flash/data boundary' }
					]
				}
	}
	return outcome
}
