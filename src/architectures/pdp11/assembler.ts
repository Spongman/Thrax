import type { AssemblySources, Diagnostic } from '../contracts'
import { AssemblyError } from '../../core/diagnostics'
import { assembleStatements, defaultLimits, StatementKind as S, type Statement } from '../../core/assembly/assembler'
import { expressionParser, reservationBytes } from '../../core/assembly/frontend'
import { integerArithmetic } from '../../core/assembly/integerArithmetic'
import { ExprKind, Op, type Expr, type ExpressionSyntax } from '../../core/assembly/expressions'
import { visitSourceLines } from '../../core/assembly/sourceLines'
import type { Position } from '../../core/assembly/tokens'
import type { CpuConfiguration } from '../../core/configuredCpu'
import * as dec from './decFloat'

/**
 * A MACRO-11 flavoured frontend over the shared two-pass engine.  Numbers are
 * octal unless they end in a point; operators have no precedence and group with
 * angle brackets; `n$` labels are local to the span between ordinary labels.
 */

// MACRO-11 evaluates strictly left to right.
const syntax: ExpressionSyntax = {
	binary: new Map([['+', Op.Add], ['-', Op.Sub], ['*', Op.Mul], ['/', Op.Div], ['&', Op.And], ['|', Op.Or]].map(([text, op]) => [text as string, { op: op as number, precedence: 1 }])),
	unary: new Map([['-', Op.Neg], ['+', Op.Plus], ['~', Op.Not]]),
	dot: '.',
}

const TOKENS = /\s+|\^[bodx]\s*[\da-f]+\.?|\^c|\^f\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|'[\s\S]|"[\s\S]{2}|\$?\d+\$(?:\.\d+)?|\d+\.(?!\d)|\d+|[A-Za-z_.$][\w.$]*|./gi

function numberValue(text: string, radix: number): number {
	const prefixed = /^\^([bodx])\s*([\da-f]+)(\.?)$/i.exec(text)
	if (prefixed) {
		const base = { b: 2, o: 8, d: 10, x: 16 }[prefixed[1].toLowerCase() as 'b']
		return digits(prefixed[2], prefixed[3] ? 10 : base, text)
	}
	if (/^\^f/i.test(text)) return floatWord(text.slice(2).trim())
	if (text.startsWith("'")) return text.charCodeAt(1) & 255
	if (text.startsWith('"')) return text.charCodeAt(1) & 255 | (text.charCodeAt(2) & 255) << 8
	if (text.endsWith('.')) return digits(text.slice(0, -1), 10, text)
	return digits(text, radix, text)
}

function digits(text: string, radix: number, original: string): number {
	const valid = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^\d+$/, 16: /^[\da-f]+$/i }[radix as 8]
	if (!valid.test(text)) throw new Error(`'${original}' is not a base-${radix} number${radix === 8 ? '; write a trailing point for decimal, as 10.' : ''}`)
	return Number.parseInt(text, radix)
}

/** `^F` is the upper word of an F value, rounded. */
function floatWord(text: string): number {
	const parsed = dec.parseDecimal(text, true)
	if (!parsed) throw new Error(`'${text}' is not a floating literal`)
	const value = dec.unpack(parsed.raw, true)
	if (!value.m) return 0
	return Number(dec.round({ negative: value.negative, m: (value.m >> 48n) + (value.m >> 47n & 1n), e: value.e + 48 }, false).raw >> 48n)
}

function parser(radix: number) {
	return expressionParser({
		syntax, tokens: TOKENS,
		isNumber: part => /^(?:\d|\^[bodxf]|'|")/i.test(part) && !/\$/.test(part),
		number: part => numberValue(part, radix),
		operator: part => ({ '<': '(', '>': ')', '!': '|', '^c': '~', '^C': '~' } as Record<string, string>)[part],
	})
}
const parsers = new Map<number, ReturnType<typeof parser>>()
export function expression(text: string, at: Position, radix = 8): Expr {
	let parse = parsers.get(radix)
	if (!parse) parsers.set(radix, parse = parser(radix))
	try { return parse(text, at) } catch (error) {
		throw error instanceof AssemblyError ? error : new AssemblyError(error instanceof Error ? error.message : String(error), at)
	}
}

/** Remove a `;` comment, stepping over character constants and `.ASCII` delimiters. */
export function stripComment(text: string): string {
	const ascii = /^\s*(?:(?:\d+\$|[A-Za-z_.$][\w.$]*)::?\s*)*\.ascii[z]?\b/i.exec(text)
	let i = ascii ? ascii[0].length : 0
	while (i < text.length) {
		const ch = text[i]
		if (ch === ';') return text.slice(0, i)
		if (ascii) {
			if (/\s|,/.test(ch)) i++
			else if (ch === '<') { const end = text.indexOf('>', i); i = end < 0 ? text.length : end + 1 }
			else { const end = text.indexOf(ch, i + 1); i = end < 0 ? text.length : end + 1 }
		} else i += ch === "'" ? 2 : ch === '"' ? 3 : 1
	}
	return text
}

/** Commas at bracket depth zero separate operands; character constants are opaque. */
export function splitArguments(text: string): string[] {
	const out: string[] = []
	let depth = 0, start = 0
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch === "'") i++
		else if (ch === '"') i += 2
		else if (ch === '(' || ch === '<') depth++
		else if (ch === ')' || ch === '>') { if (--depth < 0) throw new Error(`Unbalanced ${ch}`) }
		else if (ch === ',' && !depth) { out.push(text.slice(start, i).trim()); start = i + 1 }
	}
	if (depth) throw new Error('Unclosed operand delimiter')
	if (text.trim()) out.push(text.slice(start).trim())
	return out
}

const IGNORED = new Set(['.title', '.sbttl', '.ident', '.enabl', '.dsabl', '.list', '.nlist', '.page', '.globl', '.global', '.asect', '.csect', '.psect', '.mcall', '.limit'])

export function assemble(sources: AssemblySources, config: CpuConfiguration): { image: import('../../core/assembly/emitter').AssemblyImage | null, diagnostics: Diagnostic[] } {
	const statements: Statement[] = [], errors: Diagnostic[] = []
	let radix = 8, block = 0, ended = false, entry: Expr | null = null
	// Local labels n$ belong to the block opened by the last ordinary label.
	const local = (text: string) => text.replace(/(?<![\w.$])(\d+)\$(?![\w$])/g, (_, n: string) => `$${n}$.${block}`)
	try {
		const first = sources.entries[0] ?? sources.files[0]?.name ?? 'main.asm'
		visitSourceLines(sources.files, first, { expansions: 4096, depth: 64, lines: 200_000 }, ({ text, at }) => {
			if (ended) return
			try {
				let line = stripComment(text).trim()
				for (;;) {
					const label = /^(\d+\$|[A-Za-z_.$][\w.$]*)(::?)\s*/.exec(line)
					if (!label || label[1] === '.') break
					if (!/^\d+\$$/.test(label[1])) block++
					statements.push({ kind: S.Label, name: local(label[1]), at })
					line = line.slice(label[0].length)
				}
				if (!line) return
				const lineRadix = radix
				const parse = (source: string) => expression(local(source), at, lineRadix)
				const assign = /^(\.|[A-Za-z_$][\w.$]*)\s*==?:?\s*(.+)$/.exec(line)
				if (assign) {
					if (assign[1] === '.') statements.push({ kind: S.Origin, value: parse(assign[2]), at })
					else statements.push({ kind: S.Assign, name: assign[1], value: parse(assign[2]), at })
					return
				}
				const match = /^(\S+)\s*(.*)$/.exec(line)!
				const name = match[1].toLowerCase(), rest = match[2]
				if (name === '.ascii' || name === '.asciz') {
					statements.push(...asciiStatements(rest, at, lineRadix, name === '.asciz'))
					return
				}
				const args = splitArguments(rest)
				if (IGNORED.has(name)) return
				switch (name) {
					case '.end': ended = true; if (args.length) entry = parse(args[0]); return
					case '.radix': {
						const value = args.length ? Number.parseInt(args[0].replace(/\.$/, ''), 10) : 8
						if (![2, 8, 10, 16].includes(value)) throw new AssemblyError('.RADIX takes 2, 8, 10 or 16 (in decimal)', at)
						radix = value
						return
					}
					case '.include': {
						if (args.length !== 1) throw new AssemblyError('.INCLUDE needs one quoted file name', at)
						const quoted = /^(["/])(.*)\1$/.exec(args[0])
						if (!quoted) throw new AssemblyError('.INCLUDE needs one quoted file name', at)
						return quoted[2]
					}
					case '.text': case '.data':
						statements.push({ kind: S.Section, section: name === '.data' ? 1 : 0, at })
						if (args.length) statements.push({ kind: S.Origin, value: parse(args[0]), at })
						return
					case '.equ': case '.set':
						if (args.length !== 2) throw new AssemblyError(`${name.toUpperCase()} needs a name and a value`, at)
						statements.push({ kind: S.Assign, name: args[0], value: parse(args[1]), at })
						return
					case '.even': statements.push({ kind: S.Align, boundary: { kind: ExprKind.Number, value: 2 }, at }); return
					case '.word': case '.byte': {
						const size = name === '.word' ? 2 : 1
						for (const arg of args.length ? args : ['0']) statements.push({ kind: S.Emit, size, value: parse(arg), at })
						return
					}
					case '.blkw': case '.blkb': {
						const unit = name === '.blkw' ? 2 : 1, count = args.length ? parse(args[0]) : { kind: ExprKind.Number, value: 1 } as Expr
						statements.push({ kind: S.Fragment, size: ctx => ctx.value(count, true)! * unit, encode: (_ctx, size) => reservationBytes(size, 1, config.memoryBytes, 'Reservation exceeds memory'), provenance: 'data', at })
						return
					}
					case '.flt2': case '.flt4': {
						const double = name === '.flt4'
						for (const arg of args) {
							const parsed = dec.parseDecimal(arg, double)
							if (!parsed) throw new AssemblyError(`'${arg}' is not a decimal floating literal`, at)
							if (parsed.overflow) throw new AssemblyError(`${arg} is too large for a DEC floating value`, at)
							statements.push({ kind: S.Bytes, bytes: Uint8Array.from(dec.toWords(parsed.raw, double).flatMap(w => [w & 255, w >>> 8])), at })
						}
						return
					}
				}
				if (name.startsWith('.')) throw new AssemblyError(`Unknown directive ${match[1]}`, at)
				const operands = args.map(local)
				const length = config.instructionSize(name, operands)
				statements.push({ kind: S.Fragment, size: length, encode: ctx => {
					if (ctx.dot & 1) throw new AssemblyError('Instruction at an odd address; add .EVEN', at)
					try { return config.encode(name, operands, { address: ctx.dot, value: source => ctx.value(expression(source, at, lineRadix), true)! }) }
					catch (error) { throw error instanceof AssemblyError ? error : new AssemblyError(error instanceof Error ? error.message : String(error), at) }
				}, provenance: 'instruction', at })
			} catch (error) {
				if (errors.length > 100) throw error
				errors.push(error instanceof AssemblyError ? error.diagnostic : { severity: 'error', message: error instanceof Error ? error.message : String(error), file: at.file, line: at.line, column: at.column })
			}
			return undefined
		})
		if (errors.length) return { image: null, diagnostics: errors }
		let start: number | undefined
		if (entry) statements.push({ kind: S.Hook, run: ctx => { if (ctx.emitting) start = ctx.value(entry!, true) }, at: { file: first, line: 1, column: 1 } })
		const outcome = assembleStatements(statements, {
			arithmetic: integerArithmetic, littleEndian: true,
			checkValue: (value, size, at) => {
				if (!Number.isInteger(value) || value < -(2 ** (size * 8 - 1)) || value >= 2 ** (size * 8)) throw new AssemblyError(`Value exceeds ${size * 8} bits`, at)
				return value
			}, defaultAlignment: 1, originMayDecrease: true,
			entryAddress: config.textBase, isInstructionMacro: () => false,
			limits: { ...defaultLimits, addressLimit: config.memoryBytes, maxBytes: config.memoryBytes },
			sections: [{ start: config.textBase }, { start: config.dataBase }],
		})
		if (outcome.image) outcome.image = { ...outcome.image,
			entryAddress: start ?? outcome.image.sourceMappings.find(row => row.kind === 'instruction')?.address ?? config.textBase,
			symbols: [...outcome.symbols.entries()].filter((symbol): symbol is [string, number] => symbol[1] !== undefined && !/^\$\d+\$\.\d+$/.test(symbol[0])).map(([name, address]) => ({ name, address })),
		}
		return outcome
	} catch (error) {
		return { image: null, diagnostics: [...errors, error instanceof AssemblyError ? error.diagnostic : { severity: 'error' as const, message: error instanceof Error ? error.message : String(error) }] }
	}
}

/** `.ASCII` bytes as statements, so `<expr>` values may name later symbols. */
function asciiStatements(text: string, at: Position, radix: number, terminated: boolean): Statement[] {
	const out: Statement[] = []
	let i = 0, run: number[] = []
	const flush = () => { if (run.length) out.push({ kind: S.Bytes, bytes: Uint8Array.from(run), at }); run = [] }
	while (i < text.length) {
		const ch = text[i]
		if (/\s|,/.test(ch)) { i++; continue }
		if (ch === '<') {
			const end = text.indexOf('>', i)
			if (end < 0) throw new AssemblyError('Unclosed < in .ASCII', at)
			flush()
			out.push({ kind: S.Emit, size: 1, value: expression(text.slice(i + 1, end), at, radix), at })
			i = end + 1
			continue
		}
		const end = text.indexOf(ch, i + 1)
		if (end < 0) throw new AssemblyError(`Unclosed ${ch} delimiter in .ASCII`, at)
		for (const char of text.slice(i + 1, end)) run.push(char.charCodeAt(0) & 255)
		i = end + 1
	}
	if (terminated) run.push(0)
	flush()
	return out
}
