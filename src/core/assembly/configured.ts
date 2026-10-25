import type { AssemblySources } from '../../architectures/contracts'
import type { CpuConfiguration } from '../configuredCpu'
import { AssemblyError } from '../diagnostics'
import { assembleStatements, defaultLimits, StatementKind as S, type Statement } from './assembler'
import { expressionParser, integerSyntax, quotedBytes, reservationBytes } from './frontend'
import { integerArithmetic } from './integerArithmetic'
import { Op, type Expr } from './expressions'
import { visitSourceLines } from './sourceLines'
import { splitOperands, stripAssemblyComment } from './text'
import type { Position } from './tokens'

const syntax = integerSyntax(Op.Sar, true)
const parse = expressionParser({
	syntax,
	tokens: /\s+|0x[\da-f]+|0b[01]+|\d+|'(?:[^'\\]|\\.)'|[A-Za-z_.$][\w.$]*|<<|>>|./gi,
	isNumber: part => /^(?:\d|')/.test(part),
	number: part => part.startsWith("'") ? part[1] === '\\' ? ({ n: 10, r: 13, t: 9, '0': 0 }[part[2]] ?? part.charCodeAt(2)) : part.charCodeAt(1) : Number(part),
})

function expression(text: string, at: Position): Expr {
	// Prefix spellings are dialect configuration, while precedence and evaluation
	// remain in the shared assembler. Quoted characters are left untouched.
	const normal = text.replace(/'(?:[^'\\]|\\.)'|\$([\da-f]+)\b|(?<!>)>([\da-f]+)\b|%([01]+)\b/gi,
		(match, dollar, ti, binary) => dollar || ti ? `0x${dollar ?? ti}` : binary ? `0b${binary}` : match)
	return parse(normal, at)
}

/** Shared two-pass statement frontend; native encoders determine every opcode. */
export function assembleConfigured(sources: AssemblySources, config: CpuConfiguration) {
	const statements: Statement[] = []
	try {
		const entry = sources.entries[0] ?? sources.files[0]?.name ?? 'main.asm'
		visitSourceLines(sources.files, entry, { expansions: 4096, depth: 64, lines: 200_000 }, ({ text, at }) => {
			let line = stripAssemblyComment(text, config.comments ?? [';', '//']).trim()
			if (!line) return
			for (;;) {
				const label = /^([A-Za-z_.$][\w.$]*):\s*/.exec(line)
				if (!label) break
				statements.push({ kind: S.Label, name: label[1], at })
				line = line.slice(label[0].length)
			}
			if (!line) return
			const assign = /^([A-Za-z_.$][\w.$]*)(?:\s*=\s*|\s+equ\s+)(.+)$/i.exec(line)
			if (assign) {
				statements.push({ kind: S.Assign, name: assign[1], value: expression(assign[2], at), at })
				return
			}
			const match = /^(\S+)\s*(.*)$/.exec(line)!
			const name = match[1].toLowerCase(), args = splitOperands(match[2], { brackets: ['()', '[]'], unclosed: 'Unclosed operand delimiter' })
			if (name === '.include' || name === 'include') {
				if (args.length !== 1 || !/^".*"$/.test(args[0])) throw new AssemblyError('Include needs one quoted filename', at)
				return JSON.parse(args[0]) as string
			}
			if (name === '.text' || name === '.code' || name === '.data') {
				statements.push({ kind: S.Section, section: name === '.data' ? 1 : 0, at })
				if (args.length) statements.push({ kind: S.Origin, value: expression(args[0], at), at })
				return
			}
			if (name === '.org' || name === 'org' || name === 'aorg') {
				if (args.length !== 1) throw new AssemblyError('Origin needs one address', at)
				statements.push({ kind: S.Origin, value: expression(args[0], at), at })
				return
			}
			if (name === '.equ' || name === '.set') {
				if (args.length !== 2) throw new AssemblyError('Equate needs a name and value', at)
				statements.push({ kind: S.Assign, name: args[0], value: expression(args[1], at), at })
				return
			}
			if (['.ascii', '.asciz', '.asciiz', '.string', 'text'].includes(name)) {
				statements.push({ kind: S.Bytes, bytes: quotedBytes(args, name !== '.ascii' && name !== 'text'), at })
				return
			}
			if (name === '.align') {
				if (args.length !== 1) throw new AssemblyError('Align needs one byte boundary', at)
				statements.push({ kind: S.Align, boundary: expression(args[0], at), at })
				return
			}
			if (['.space', '.skip', '.res', 'rmb', 'ds', '.ds', 'bss'].includes(name)) {
				if (args.length !== 1) throw new AssemblyError('Reservation needs one byte count', at)
				statements.push({ kind: S.Fragment, size: ctx => ctx.value(expression(args[0], at), true)!, encode: (_ctx, size) => reservationBytes(size, 1, config.memoryBytes, 'Reservation exceeds RAM'), provenance: 'data', at })
				return
			}
			const size = config.directiveWidths?.[name] ?? (['.byte', 'byte', 'db', 'fcb'].includes(name) ? 1 : ['.word', 'word', 'dw', 'fdb', 'data'].includes(name) ? 2 : ['.long', '.dword', 'dd'].includes(name) ? 4 : 0)
			if (size) {
				if (!args.length) throw new AssemblyError('Data directive needs values', at)
				for (const arg of args) {
					if (size === 1 && arg.startsWith('"')) statements.push({ kind: S.Bytes, bytes: quotedBytes([arg], false), at })
					else statements.push({ kind: S.Emit, size, value: expression(arg, at), at })
				}
				return
			}
			if (name === '.quad') {
				if (!args.length) throw new AssemblyError('Quad directive needs values', at)
				for (const arg of args) {
					const value = BigInt(arg.replace(/^\$/, '0x'))
					if (value < -(1n << 63n) || value >= 1n << 64n) throw new AssemblyError('Quad value exceeds 64 bits', at)
					const bits = BigInt.asUintN(64, value)
					statements.push({ kind: S.Bytes, bytes: Uint8Array.from({ length: 8 }, (_, i) => Number(bits >> BigInt(8 * (config.littleEndian ? i : 7 - i)) & 255n)), at })
				}
				return
			}
			if (['.global', '.globl', '.end', 'end'].includes(name)) return
			const length = config.instructionSize(name, args)
			if (!Number.isInteger(length) || length <= 0 || length > 32) throw new AssemblyError(`Invalid instruction '${name}'`, at)
			statements.push({ kind: S.Fragment, size: length, encode: ctx => {
				if (ctx.dot % config.instructionAlignment) throw new AssemblyError('Misaligned instruction', at)
				try { return config.encode(name, args, { address: ctx.dot, value: text => ctx.value(expression(text, at), true)! }) }
				catch (error) { throw error instanceof AssemblyError ? error : new AssemblyError(error instanceof Error ? error.message : String(error), at) }
			}, provenance: 'instruction', at })
		})
		const outcome = assembleStatements(statements, {
			arithmetic: integerArithmetic, littleEndian: config.littleEndian,
			checkValue: (value, size, at) => {
				if (!Number.isInteger(value) || value < -(2 ** (size * 8 - 1)) || value >= 2 ** (size * 8)) throw new AssemblyError(`Value exceeds ${size * 8} bits`, at)
				return value
			}, defaultAlignment: 1, originMayDecrease: true,
			entryAddress: config.textBase, isInstructionMacro: () => false,
			limits: { ...defaultLimits, addressLimit: config.memoryBytes, maxBytes: config.memoryBytes },
			sections: [{ start: config.textBase }, { start: config.dataBase }],
		})
		if (outcome.image) outcome.image = { ...outcome.image,
			entryAddress: outcome.image.sourceMappings.find(row => row.kind === 'instruction')?.address ?? config.textBase,
			symbols: [...outcome.symbols.entries()].filter((entry): entry is [string, number] => entry[1] !== undefined).map(([name, address]) => ({ name, address })),
		}
		return outcome
	} catch (error) {
		return { image: null, diagnostics: [error instanceof AssemblyError ? error.diagnostic : { severity: 'error' as const, message: error instanceof Error ? error.message : String(error) }] }
	}
}
