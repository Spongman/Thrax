/** GNU unified Thumb syntax over the common two-pass assembler. No ARM/Thumb-2 fallback. */
import {
	assembleStatements,
	defaultLimits,
	StatementKind as K,
	type HookContext,
	type Statement,
} from '../../../core/assembly/assembler'
import { Op, parseExpression, type Expr } from '../../../core/assembly/expressions'
import { expandSources } from '../../../core/assembly/sources'
import { TokenCursor, TokenKind, type Position } from '../../../core/assembly/tokens'
import { AssemblyError } from '../../../core/diagnostics'
import { DIALECT_GNU } from '../../arm/assembler/dialect'
import { armArithmetic, checkDataValue, gnuExpressionSyntax } from '../../arm/assembler/syntax'
import { tokenizeArm } from '../../arm/assembler/tokenizer'
import type { AssemblySources, Diagnostic } from '../../contracts'
import { ALU, CONDITIONS, DATA_BASE, reg, SPECIAL, TEXT_BASE } from './isa'
import { M0Program } from './program'

function expr(text: string, at: Position): Expr {
	const tokens = tokenizeArm({ name: at.file, code: text.replace(/^#/, '') }, DIALECT_GNU).filter(
		(t) => t.kind !== TokenKind.Newline,
	)
	const cursor = new TokenCursor(tokens)
	const result = parseExpression(cursor, gnuExpressionSyntax)
	if (!result || !cursor.atEnd()) throw new AssemblyError(`Invalid expression '${text}'`, at)
	return result
}
function range(v: number, lo: number, hi: number) {
	if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`Value ${v} outside ${lo}..${hi}`)
	return v
}
function bytes(...words: number[]) {
	return words.flatMap((w) => [w & 255, (w >>> 8) & 255])
}
function operands(text: string): string[] {
	let depth = 0,
		quote = '',
		escaped = false,
		start = 0
	const out: string[] = []
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (escaped) {
			escaped = false
			continue
		}
		if (quote) {
			if (ch === '\\') escaped = true
			else if (ch === quote) quote = ''
			continue
		}
		if (ch === '"' || ch === "'") {
			quote = ch
			continue
		}
		if ('[{('.includes(ch)) depth++
		if (']})'.includes(ch)) depth--
		if (ch === ',' && depth === 0) {
			out.push(text.slice(start, i).trim())
			start = i + 1
		}
	}
	if (text.trim()) out.push(text.slice(start).trim())
	return out
}
function stripComment(text: string) {
	let quote = '',
		escaped = false
	for (let n = 0; n < text.length; n++) {
		const ch = text[n]
		if (escaped) {
			escaped = false
			continue
		}
		if (quote) {
			if (ch === '\\') escaped = true
			else if (ch === quote) quote = ''
			continue
		}
		if (ch === '"' || ch === "'") quote = ch
		else if (ch === '@' || (ch === '/' && text[n + 1] === '/')) return text.slice(0, n)
	}
	return text
}
export function encode(name: string, args: string[], c: HookContext, at: Position): number[] {
	const count = (n: number) => {
		if (args.length !== n) throw new Error(`${name} expects ${n} operands`)
	}
	const r = (n: number, high = false) => range(reg(args[n] ?? ''), 0, high ? 15 : 7)
	const v = (text: string) => c.value(expr(text, at), true)!
	const imm = (text: string, max: number, scale = 1) => range(v(text) / scale, 0, max)
	const list = (text: string, special: number) => {
		if (!/^\{.*\}$/.test(text)) throw new Error('Expected register list')
		let mask = 0
		for (const item of operands(text.slice(1, -1))) {
			const pair = item.split('-').map((s) => reg(s.trim())),
				first = pair[0],
				last = pair[1] ?? first
			if (last < first) throw new Error('Reversed register range')
			for (let n = first; n <= last; n++) {
				if (n > 7 && n !== special) throw new Error('Register not encodable in this list')
				if (mask & (1 << n)) throw new Error('Duplicate register')
				mask |= 1 << n
			}
		}
		if (!mask) throw new Error('Empty register list')
		return mask
	}
	const branch = (bits: number) =>
		range((v(args[0]) - c.dot - 4) / 2, -(2 ** (bits - 1)), 2 ** (bits - 1) - 1)
	if (name === 'bl') {
		count(1)
		const off = branch(24) * 2,
			s = (off >>> 24) & 1,
			i1 = (off >>> 23) & 1,
			i2 = (off >>> 22) & 1
		return bytes(
			0xf000 | (s << 10) | ((off >>> 12) & 1023),
			0xd000 | ((1 ^ i1 ^ s) << 13) | ((1 ^ i2 ^ s) << 11) | ((off >>> 1) & 2047),
		)
	}
	if (name === 'b') {
		count(1)
		return bytes(0xe000 | (branch(11) & 2047))
	}
	const cond = CONDITIONS.indexOf(
		name.slice(1) === 'hs' ? 'cs' : name.slice(1) === 'lo' ? 'cc' : name.slice(1),
	)
	if (name.startsWith('b') && cond >= 0) {
		count(1)
		return bytes(0xd000 | (cond << 8) | (branch(8) & 255))
	}
	if (name === 'bx' || name === 'blx') {
		count(1)
		const n = r(0, true)
		if (n === 13 || n === 15) throw new Error('SP and PC cannot be exchange operands')
		return bytes((name === 'blx' ? 0x4780 : 0x4700) | (n << 3))
	}
	if (['svc', 'bkpt', 'udf'].includes(name)) {
		count(1)
		return bytes(
			({ svc: 0xdf00, bkpt: 0xbe00, udf: 0xde00 } as Record<string, number>)[name] | imm(args[0], 255),
		)
	}
	if (['nop', 'yield', 'wfe', 'wfi', 'sev'].includes(name)) {
		count(0)
		return bytes(0xbf00 | (['nop', 'yield', 'wfe', 'wfi', 'sev'].indexOf(name) << 4))
	}
	if (['dmb', 'dsb', 'isb'].includes(name)) {
		if (args.length > 1 || (args.length && args[0].toLowerCase() !== 'sy' && args[0] !== '#15'))
			throw new Error('Only SY barrier is supported')
		return bytes(0xf3bf, ({ dsb: 0x8f4f, dmb: 0x8f5f, isb: 0x8f6f } as Record<string, number>)[name])
	}
	if (name === 'cpsid' || name === 'cpsie') {
		count(1)
		if (args[0].toLowerCase() !== 'i') throw new Error('Only PRIMASK interrupt mask is supported')
		return bytes(name === 'cpsid' ? 0xb672 : 0xb662)
	}
	if (name === 'mrs' || name === 'msr') {
		count(2)
		const key = args[name === 'mrs' ? 1 : 0].toLowerCase().replace('_nzcvq', ''),
			spec = SPECIAL[key]
		if (spec === undefined) throw new Error('Unsupported special register')
		const n = r(name === 'mrs' ? 0 : 1, true)
		if (n === 13 || n === 15) throw new Error('Special-register transfer cannot use SP or PC')
		return name === 'mrs' ? bytes(0xf3ef, 0x8000 | (n << 8) | spec) : bytes(0xf380 | n, 0x8800 | spec)
	}
	if (name === 'push' || name === 'pop') {
		count(1)
		const special = name === 'push' ? 14 : 15,
			mask = list(args[0], special)
		return bytes((name === 'push' ? 0xb400 : 0xbc00) | (mask & 255) | (mask & (1 << special) ? 0x100 : 0))
	}
	if (['ldmia', 'stmia', 'ldm', 'stm'].includes(name)) {
		count(2)
		const base = reg(args[0].replace(/!$/, '')),
			mask = list(args[1], -1)
		range(base, 0, 7)
		if (name.startsWith('stm') && mask & (1 << base) && mask & ((1 << base) - 1))
			throw new Error('STM base in list must be lowest register')
		return bytes((name.startsWith('ldm') ? 0xc800 : 0xc000) | (base << 8) | mask)
	}
	if (['sxtb', 'sxth', 'uxtb', 'uxth', 'rev', 'rev16', 'revsh'].includes(name)) {
		count(2)
		const opcode = (
			{
				sxth: 0xb200,
				sxtb: 0xb240,
				uxth: 0xb280,
				uxtb: 0xb2c0,
				rev: 0xba00,
				rev16: 0xba40,
				revsh: 0xbac0,
			} as Record<string, number>
		)[name]
		return bytes(opcode | (r(1) << 3) | r(0))
	}
	if (name === 'adr') {
		count(2)
		return bytes(0xa000 | (r(0) << 8) | range((v(args[1]) - ((c.dot + 4) & ~3)) / 4, 0, 255))
	}
	if (['ldr', 'ldrb', 'ldrh', 'ldrsb', 'ldrsh', 'str', 'strb', 'strh'].includes(name)) {
		count(2)
		const d = r(0),
			mem = /^\[\s*([^,\]]+)\s*(?:,\s*(.+))?\]$/.exec(args[1])
		if (!mem) throw new Error('Expected [base, offset]')
		const n = reg(mem[1].trim()),
			offset = mem[2]?.trim() ?? '#0'
		if (/^(?:r\d+|sp|lr|pc)$/i.test(offset)) {
			const m = range(reg(offset), 0, 7)
			range(n, 0, 7)
			return bytes(
				0x5000 |
					(['str', 'strh', 'strb', 'ldrsb', 'ldr', 'ldrh', 'ldrb', 'ldrsh'].indexOf(name) << 9) |
					(m << 6) |
					(n << 3) |
					d,
			)
		}
		if (n === 15 && name === 'ldr') return bytes(0x4800 | (d << 8) | imm(offset, 255, 4))
		if (n === 13 && ['ldr', 'str'].includes(name))
			return bytes((name === 'ldr' ? 0x9800 : 0x9000) | (d << 8) | imm(offset, 255, 4))
		range(n, 0, 7)
		const load = name.startsWith('ldr'),
			scale = name.endsWith('b') ? 1 : name.endsWith('h') ? 2 : 4
		if (name === 'ldrsb' || name === 'ldrsh') throw new Error('Signed load requires register offset')
		return bytes(
			(scale === 2 ? 0x8000 : scale === 1 ? 0x7000 : 0x6000) |
				(load ? 0x800 : 0) |
				(imm(offset, 31, scale) << 6) |
				(n << 3) |
				d,
		)
	}
	if (['lsls', 'lsrs', 'asrs'].includes(name) && args.length === 3 && args[2].startsWith('#')) {
		const shift = ['lsls', 'lsrs', 'asrs'].indexOf(name),
			amount = range(v(args[2]), shift === 0 ? 0 : 1, shift === 0 ? 31 : 32)
		return bytes((shift << 11) | ((amount & 31) << 6) | (r(1) << 3) | r(0))
	}
	if (['adds', 'subs', 'add', 'sub', 'movs', 'mov', 'cmp'].includes(name)) {
		if (args.length < 2 || args.length > 3) throw new Error('Expected two or three operands')
		const d = r(0, true),
			immediate = args[args.length - 1].startsWith('#')
		if (immediate) {
			const last = args[args.length - 1]
			if (d === 13 && ['add', 'sub'].includes(name)) {
				if (args.length === 3 && reg(args[1]) !== 13) throw new Error('SP arithmetic requires SP source')
				return bytes((name === 'sub' ? 0xb080 : 0xb000) | imm(last, 127, 4))
			}
			if (args.length === 3 && name === 'add' && reg(args[1]) === 13)
				return bytes(0xa800 | (range(d, 0, 7) << 8) | imm(last, 255, 4))
			range(d, 0, 7)
			if (
				name === 'movs' ||
				name === 'cmp' ||
				args.length === 2 ||
				(args.length === 3 && reg(args[1]) === d && v(last) > 7)
			) {
				const opcode =
					({ movs: 0x2000, cmp: 0x2800, adds: 0x3000, subs: 0x3800 } as Record<string, number>)[name] ??
					fail('Use flag-setting mnemonic for immediate form')
				return bytes(opcode | (d << 8) | imm(last, 255))
			}
			if (!['adds', 'subs'].includes(name)) throw new Error('Use ADDS/SUBS for immediate form')
			return bytes((name === 'subs' ? 0x1e00 : 0x1c00) | (imm(last, 7) << 6) | (r(1) << 3) | d)
		}
		if (name === 'mov' || name === 'add' || (name === 'cmp' && (d >= 8 || reg(args[1]) >= 8))) {
			count(2)
			const m = r(1, true)
			if ((d === 15 && m === 15) || (name === 'cmp' && (d === 15 || m === 15)))
				throw new Error('Unpredictable PC operand')
			return bytes(
				({ add: 0x4400, cmp: 0x4500, mov: 0x4600 } as Record<string, number>)[name] |
					((d & 8) << 4) |
					(m << 3) |
					(d & 7),
			)
		}
		if (name === 'movs') {
			count(2)
			return bytes((r(1) << 3) | r(0))
		}
		if (name === 'adds' || name === 'subs') {
			const n = args.length === 3 ? r(1) : r(0),
				m = r(args.length - 1)
			return bytes((name === 'subs' ? 0x1a00 : 0x1800) | (m << 6) | (n << 3) | range(d, 0, 7))
		}
	}
	if (name === 'negs') name = 'rsbs'
	const alu = ALU.indexOf(name)
	if (alu >= 0) {
		if (name === 'rsbs' && args.length === 3) {
			if (v(args[2]) !== 0) throw new Error('RSBS immediate must be zero')
			args = args.slice(0, 2)
		}
		if (name === 'muls' && args.length === 3) {
			if (reg(args[2]) !== reg(args[0])) throw new Error('MULS third operand must equal destination')
			args = args.slice(0, 2)
		}
		count(2)
		return bytes(0x4000 | (alu << 6) | (r(1) << 3) | r(0))
	}
	throw new Error(`Unsupported ARMv6-M mnemonic '${name}'`)
}
function fail(message: string): never {
	throw new Error(message)
}

export function assembleM0(sources: AssemblySources, memoryBytes: number): M0Program {
	const diagnostics: Diagnostic[] = [],
		statements: Statement[] = [],
		main = sources.files.find((f) => f.name === sources.entries[0]) ??
			sources.files[0] ?? { name: 'main.s', code: '' }
	let section = 0,
		reserved = 0,
		literalId = 0
	let thumbFunctionPending = false
	const thumbFunctions = new Set<string>()
	let literals: { label: string; value: Expr; at: Position }[] = []
	const reserve = (n: number) => {
		reserved += n
		if (reserved > memoryBytes) throw new Error('Assembly exceeds memory limit')
	}
	const pool = (at: Position) => {
		if (!literals.length) return
		statements.push(
			{ kind: K.Section, section: 0, at },
			{ kind: K.Align, boundary: { kind: 0, value: 4 }, at },
		)
		for (const literal of literals)
			statements.push(
				{ kind: K.Label, name: literal.label, at: literal.at },
				{ kind: K.Emit, value: literal.value, size: 4, at: literal.at },
			)
		literals = []
		statements.push({ kind: K.Section, section, at })
	}
	try {
		const lines = expandSources<{ text: string; at: Position }>([main], {
			tokenize: (s) =>
				s.code
					.split(/\r?\n/)
					.map((text, line) => ({ text, at: { file: s.name, line: line + 1, column: 1 } })),
			readInclude: (stream, index) => {
				const m = /^\s*\.include\s+"([^"]+)"\s*(?:@.*)?$/.exec(stream[index].text)
				return m ? { name: m[1], nextIndex: index + 1 } : null
			},
			resolve: (name, from, token) => {
				const path = from.name.slice(0, from.name.lastIndexOf('/') + 1) + name,
					file = sources.files.find((f) => f.name === path || f.name === name)
				if (!file) throw new AssemblyError(`File not found: ${name}`, token.at)
				return file
			},
			identity: (s) => s.name,
			includeOnce: false,
			maxFileExpansions: 256,
			cycle: (s, _c, t) => new AssemblyError(`Recursive include: ${s.name}`, t?.at),
			limit: (s) => new AssemblyError(`Include limit reached: ${s.name}`),
			boundary: () => [],
		})
		for (const { text: raw, at } of lines) {
			if (statements.length > 100000) throw new AssemblyError('Expanded source exceeds statement limit', at)
			let text = stripComment(raw).trim()
			if (!text || text.startsWith('#')) continue
			while (/^[A-Za-z_.$][\w.$]*:/.test(text)) {
				const label = /^[^:]+/.exec(text)![0]
				if (thumbFunctionPending) {
					thumbFunctions.add(label)
					thumbFunctionPending = false
				}
				statements.push({ kind: K.Label, name: label, at })
				text = text.slice(label.length + 1).trim()
			}
			if (!text) continue
			const match = /^(\S+)\s*(.*)$/.exec(text)!,
				name = match[1].toLowerCase().replace(/\.n$/, ''),
				tail = match[2],
				args = operands(tail)
			if (name === '.thumb_func') {
				if (tail) thumbFunctions.add(tail)
				else thumbFunctionPending = true
				continue
			}
			if (['.syntax', '.thumb', '.global', '.globl', '.type', '.size', '.end'].includes(name)) continue
			if (name === '.cpu') {
				if (tail !== 'cortex-m0') throw new AssemblyError('This variant only implements Cortex-M0', at)
				continue
			}
			if (name === '.arch') {
				if (tail !== 'armv6-m') throw new AssemblyError('This variant only implements ARMv6-M', at)
				continue
			}
			if (name === '.ltorg' || name === '.pool') {
				pool(at)
				continue
			}
			if (['.text', '.data', '.bss', '.section'].includes(name)) {
				const key = name === '.section' ? tail.split(',')[0] : name
				if (!['.text', '.data', '.bss', '.rodata'].includes(key))
					throw new AssemblyError('Unsupported section', at)
				section = key === '.text' ? 0 : 1
				statements.push({ kind: K.Section, section, at })
				continue
			}
			if (name === '.equ' || name === '.set') {
				if (args.length !== 2) throw new AssemblyError('Expected symbol, value', at)
				statements.push({ kind: K.Assign, name: args[0], value: expr(args[1], at), at })
				continue
			}
			if (name === '.org') {
				statements.push({ kind: K.Origin, value: expr(tail, at), at })
				continue
			}
			if (['.align', '.p2align', '.balign'].includes(name)) {
				const n = Number(args[0]),
					boundary = name === '.balign' ? n : 2 ** range(n, 0, 16)
				range(boundary, 1, 65536)
				statements.push({ kind: K.Align, boundary: { kind: 0, value: boundary }, at })
				continue
			}
			if (['.ascii', '.asciz', '.string'].includes(name)) {
				const strings = args.map((a) => {
					const value = JSON.parse(a)
					if (typeof value !== 'string') throw new Error('Expected string')
					return value
				})
				const b = new TextEncoder().encode(strings.map((s) => s + (name === '.ascii' ? '' : '\0')).join(''))
				reserve(b.length)
				statements.push({ kind: K.Bytes, bytes: b, at })
				continue
			}
			if (name === '.space' || name === '.zero') {
				const n = range(Number(args[0]), 0, memoryBytes)
				reserve(n)
				statements.push({ kind: K.Bytes, bytes: new Uint8Array(n), at })
				continue
			}
			const dataSize = (
				{ '.byte': 1, '.hword': 2, '.short': 2, '.word': 4, '.long': 4 } as Record<string, number>
			)[name]
			if (dataSize) {
				for (const a of args) {
					reserve(dataSize)
					statements.push({ kind: K.Emit, value: expr(a, at), size: dataSize, at })
				}
				continue
			}
			if (name.startsWith('.')) throw new AssemblyError(`Unsupported directive '${name}'`, at)
			if (section !== 0) throw new AssemblyError('Instructions must be in .text', at)
			const literal = name === 'ldr' && args[1]?.startsWith('=') ? `.LthraxLiteral${literalId++}` : null
			if (literal) {
				reserve(4)
				literals.push({ label: literal, value: expr(args[1].slice(1), at), at })
			}
			const size = ['bl', 'mrs', 'msr', 'dmb', 'dsb', 'isb'].includes(name) ? 4 : 2
			reserve(size)
			statements.push({
				kind: K.Fragment,
				size,
				provenance: 'instruction',
				at,
				encode(c) {
					if (c.dot % 2) throw new AssemblyError('Thumb instructions require halfword alignment', at)
					try {
						return literal
							? bytes(
									0x4800 |
										(range(reg(args[0]), 0, 7) << 8) |
										range((c.value({ kind: 1, name: literal, at }, true)! - ((c.dot + 4) & ~3)) / 4, 0, 255),
								)
							: encode(name, args, c, at)
					} catch (error) {
						throw new AssemblyError((error as Error).message, at)
					}
				},
			})
		}
		pool({ file: main.name, line: main.code.split('\n').length, column: 1 })
	} catch (error) {
		diagnostics.push(
			error instanceof AssemblyError
				? error.diagnostic
				: { severity: 'error', message: (error as Error).message },
		)
	}
	if (diagnostics.length) return new M0Program(main.name, null, diagnostics)
	// Keep code/navigation labels even. Function pointers in emitted data carry
	// the Thumb state bit, including references to functions defined later.
	const pointerExpression = (value: Expr): Expr => {
		if (value.kind === 1 && thumbFunctions.has(value.name))
			return { kind: 4, op: Op.Or, left: value, right: { kind: 0, value: 1 }, at: value.at }
		if (value.kind === 3) return { ...value, operand: pointerExpression(value.operand) }
		if (value.kind === 4)
			return { ...value, left: pointerExpression(value.left), right: pointerExpression(value.right) }
		return value
	}
	for (const statement of statements)
		if (statement.kind === K.Emit || statement.kind === K.Assign)
			statement.value = pointerExpression(statement.value)
	const result = assembleStatements(statements, {
		arithmetic: armArithmetic,
		checkValue: checkDataValue,
		littleEndian: true,
		defaultAlignment: 1,
		originMayDecrease: false,
		entryAddress: TEXT_BASE,
		isInstructionMacro: () => false,
		limits: {
			...defaultLimits,
			addressBase: TEXT_BASE,
			addressLimit: TEXT_BASE + memoryBytes,
			maxBytes: memoryBytes,
		},
		sections: [{ start: TEXT_BASE }, { start: DATA_BASE }],
	})
	if (result.image)
		result.image.entryAddress = result.symbols.lookup('_start') ?? result.symbols.lookup('main') ?? TEXT_BASE
	return new M0Program(main.name, result.image, result.diagnostics)
}
