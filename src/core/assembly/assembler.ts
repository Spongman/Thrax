import type { SourceLocation } from '../../architectures/contracts'
import { AssemblyError } from '../diagnostics'
import type { Diagnostic } from '../types'
import { ByteEmitter, type AssemblyImage, type Provenance } from './emitter'
import { evaluate, type Arithmetic, type EvaluationScope, type Expr } from './expressions'
import { MacroTable, location, type ExpansionFrame, type MacroDefinition } from './macroEngine'
import { SymbolScope } from './symbols'
import type { Position } from './tokens'

/** Dialect-neutral statements produced by a dialect parser. */
export class StatementKind {
	static readonly Label = 0
	static readonly Assign = 1
	/** Move the location counter. */
	static readonly Origin = 2
	/** One value of `size` bytes. */
	static readonly Emit = 3
	static readonly Invoke = 4
	static readonly Define = 5
	static readonly Align = 6
	static readonly Bytes = 7
	/** A dialect directive run in both passes. */
	static readonly Hook = 8
	/** Select the location counter later statements advance. */
	static readonly Section = 9
	/** Select the symbol scope labels and assignments land in; null is global. */
	static readonly Scope = 10
	/** Bytes of a size fixed before layout, computed once layout is settled. */
	static readonly Fragment = 11
}

const { Label, Assign, Origin, Emit, Invoke, Define, Align, Bytes, Hook, Section, Scope, Fragment } = StatementKind

export type Statement =
	| LabelStatement
	| { kind: 1; name: string; value: Expr; at: Position }
	| { kind: 2; value: Expr; at: Position }
	| { kind: 3; value: Expr; size: number; at: Position }
	| { kind: 4; name: string; args: readonly Expr[]; at: Position }
	| { kind: 5; macro: MacroDefinition<Statement>; at: Position }
	| AlignStatement
	| { kind: 7; bytes: Uint8Array; at: Position }
	| { kind: 8; run(context: HookContext): void; at: Position }
	| { kind: 9; section: number; at: Position }
	| { kind: 10; scope: string | null; at: Position }
	| FragmentStatement

export interface LabelStatement {
	kind: 0
	name: string
	at: Position
	/** Also define the name in the global scope. */
	exported?: boolean
	/** A later carrying alignment at this label's address moves it. */
	movable?: boolean
}

export interface AlignStatement {
	kind: 6
	boundary: Expr | null
	at: Position
	/** Movable labels bound at the unaligned address move to the aligned one. */
	carry?: boolean
	/** Leave padding unwritten rather than zero-filled. */
	skip?: boolean
}

export interface FragmentStatement {
	kind: 11
	size: number
	/** Called while emitting; returns exactly `size` bytes. */
	encode(context: HookContext): ArrayLike<number>
	/** Shared by the fragment's bytes; null leaves them unmapped. */
	provenance: Provenance | null
	at: Position
}

export interface HookContext {
	/** False during layout, when only sizes matter. */
	readonly emitting: boolean
	readonly dot: number
	value(expr: Expr, strict: boolean): number | undefined
}

export interface SectionConfig {
	/** Address the section's location counter starts at. */
	start: number
	/** Where `overwrite` lets sections overlap, a higher layer's bytes win. */
	layer?: number
}

export interface AssemblerLimits {
	/** Inclusive lower bound of the address space; 0 when absent. */
	addressBase?: number
	/** Exclusive upper bound of the address space. */
	addressLimit: number
	/** Accept a fractional origin rather than diagnosing it; integers only when absent. */
	fractionalOrigins?: boolean
	maxBytes: number
	macroDepth: number
	/** Macro invocations per pass. */
	macroExpansions: number
	diagnostics: number
}

export const defaultLimits: AssemblerLimits = {
	addressLimit: 2 ** 32,
	maxBytes: 16 * 1024 * 1024,
	macroDepth: 256,
	macroExpansions: 1_000_000,
	diagnostics: 100,
}

export interface AssemblerConfig {
	arithmetic: Arithmetic
	/** Range-check a value for `size` bytes, returning the value to store. */
	checkValue(value: number, size: number, at: Position): number
	littleEndian: boolean
	defaultAlignment: number
	originMayDecrease: boolean
	entryAddress: number | null
	/** Bytes emitted while expanding such a macro form one instruction mapping. */
	isInstructionMacro(macro: MacroDefinition<Statement>): boolean
	limits: AssemblerLimits
	/** Location counters selected by Section statements; one starting at 0 when absent. */
	sections?: readonly SectionConfig[]
	/** Later bytes replace earlier ones at the same address instead of failing. */
	overwrite?: boolean
	/** Emitted addresses wrap modulo this size, as a fixed-width address bus does. */
	addressModulus?: number
}

export interface AssemblyOutcome {
	image: AssemblyImage | null
	diagnostics: Diagnostic[]
	/** Global symbols after the final pass. */
	symbols: SymbolScope
	/** Scopes selected by name, each a child of `symbols`. */
	scopes: ReadonlyMap<string, SymbolScope>
}

/** A label a carrying alignment may move, with every scope it was written to. */
interface MovableLabel { name: string; scopes: SymbolScope[]; value: number }

/**
 * Two passes: layout sizes everything with forward references unresolved, then
 * emission evaluates strictly using the symbol values layout left behind.
 * Label addresses are compared between passes so nonconvergent layout is
 * reported rather than silently producing inconsistent code.
 */
export function assembleStatements(statements: readonly Statement[], config: AssemblerConfig): AssemblyOutcome {
	return new Engine(config).run(statements)
}

class Engine implements EvaluationScope, HookContext {
	emitting = false
	private readonly global = new SymbolScope()
	private scope = this.global
	private readonly scopes = new Map<string, SymbolScope>()
	private readonly starts: readonly number[]
	private readonly layers: readonly number[]
	private readonly dots: number[]
	private section = 0
	private movable: MovableLabel[] = []
	private readonly macros = new MacroTable<Statement>()
	private readonly frames: ExpansionFrame[] = []
	/** Innermost expansion an error passed through, for its message. */
	private readonly faultFrames = new WeakMap<Error, string[]>()
	private emitter: ByteEmitter | null = null
	/** Position of the statement being executed; its location is made on demand. */
	private at: Position = { file: '', line: 0, column: 0 }
	private located: SourceLocation | null = null
	private data: Provenance | null = null
	private instruction: Provenance | null = null
	private expansions = 0
	private readonly labelTrace: number[] = []
	private labelIndex = 0
	private readonly labels = new Map<string, number>()
	private readonly diagnostics: Diagnostic[] = []

	constructor(private readonly config: AssemblerConfig) {
		const sections = config.sections ?? [{ start: 0 }]
		this.starts = sections.map((section) => section.start)
		this.layers = sections.map((section) => section.layer ?? 0)
		this.dots = [...this.starts]
	}

	get dot() {
		return this.dots[this.section]
	}

	set dot(value: number) {
		this.dots[this.section] = value
	}

	lookup(name: string) {
		return this.scope.lookup(name)
	}

	value(expr: Expr, strict: boolean) {
		return evaluate(expr, this, this.config.arithmetic, strict)
	}

	run(statements: readonly Statement[]): AssemblyOutcome {
		const failed = () => ({ image: null, diagnostics: this.diagnostics, symbols: this.global, scopes: this.scopes })
		if (!this.pass(statements, false)) return failed()
		const emitter = this.emitter = new ByteEmitter()
		if (!this.pass(statements, true)) return failed()
		const { sections, overlap } = emitter.sections(this.config.overwrite ?? false)
		if (overlap !== null) {
			this.diagnostics.push(new AssemblyError(`Assembled bytes overlap at address 0x${overlap.toString(16)}`).diagnostic)
			return failed()
		}
		const symbols = [...this.labels].map(([name, address]) => ({ name, address })).sort((a, b) => a.address - b.address)
		return {
			image: { sections, entryAddress: this.config.entryAddress, symbols, sourceMappings: emitter.sourceMappings() },
			diagnostics: this.diagnostics,
			symbols: this.global,
			scopes: this.scopes,
		}
	}

	private get source(): SourceLocation {
		return this.located ??= location(this.at)
	}

	private pass(statements: readonly Statement[], emitting: boolean): boolean {
		this.emitting = emitting
		this.dots.splice(0, this.dots.length, ...this.starts)
		this.section = 0
		this.scope = this.global
		this.movable = []
		this.expansions = 0
		this.labelIndex = 0
		for (const statement of statements) {
			this.at = statement.at
			this.located = null
			this.data = null
			try {
				this.execute(statement)
			} catch (error) {
				if (!(error instanceof AssemblyError)) throw error
				this.diagnostics.push(error.diagnostic)
				if (this.diagnostics.length >= this.config.limits.diagnostics) break
			}
		}
		return this.diagnostics.length === 0
	}

	private execute(statement: Statement) {
		switch (statement.kind) {
			case Label: return this.label(statement)
			case Assign: return this.scope.assign(statement.name, this.value(statement.value, this.emitting))
			case Origin: return this.origin(this.value(statement.value, true)!, statement.at)
			case Emit: return this.emit(statement.value, statement.size, statement.at)
			case Invoke: return this.invoke(statement.name, statement.args, statement.at)
			case Define:
				if (!this.emitting) this.macros.define(statement.macro)
				return
			case Align: return this.align(statement)
			case Bytes:
				this.reserve(statement.bytes.length, statement.at)
				for (const byte of statement.bytes) this.write(byte, this.provenance())
				return
			case Hook: return statement.run(this)
			case Section:
				if (!Number.isInteger(statement.section) || statement.section < 0 || statement.section >= this.dots.length) {
					throw new RangeError(`No section ${statement.section}`)
				}
				this.section = statement.section
				return
			case Scope: return this.enterScope(statement.scope)
			case Fragment: return this.fragment(statement)
		}
	}

	private enterScope(name: string | null) {
		if (name === null) {
			this.scope = this.global
			return
		}
		let scope = this.scopes.get(name)
		if (!scope) this.scopes.set(name, scope = new SymbolScope(this.global))
		this.scope = scope
	}

	private label(statement: LabelStatement) {
		const { name, at } = statement
		const scopes = statement.exported && this.scope !== this.global ? [this.scope, this.global] : [this.scope]
		for (const scope of scopes) scope.assign(name, this.dot)
		if (statement.movable) this.movable.push({ name, scopes, value: this.dot })
		if (!this.emitting) {
			this.labelTrace.push(this.dot)
		} else {
			const before = this.labelTrace[this.labelIndex++]
			if (before !== this.dot) {
				throw new AssemblyError(`Label ${name} moved from 0x${before?.toString(16)} to 0x${this.dot.toString(16)} between passes; layout did not converge`, at)
			}
			if (scopes.includes(this.global)) this.labels.set(name, this.dot)
		}
	}

	private align(statement: AlignStatement) {
		const boundary = statement.boundary ? this.value(statement.boundary, true)! : this.config.defaultAlignment
		if (!Number.isSafeInteger(boundary) || boundary <= 0) throw new AssemblyError(`Alignment must be a positive integer, not ${boundary}`, statement.at)
		const remainder = this.dot % boundary
		if (!remainder) return
		const from = this.dot
		const count = boundary - remainder
		if (statement.skip) {
			this.reserve(count, statement.at)
			this.dot += count
		} else {
			this.fill(count, statement.at)
		}
		if (!statement.carry) return
		for (const label of this.movable) {
			if (label.value !== from) continue
			label.value = this.dot
			for (const scope of label.scopes) scope.assign(label.name, this.dot)
			if (this.emitting && label.scopes.includes(this.global)) this.labels.set(label.name, this.dot)
		}
	}

	private fragment(statement: FragmentStatement) {
		const { size, at } = statement
		this.reserve(size, at)
		if (!this.emitting) {
			this.dot += size
			return
		}
		let bytes: ArrayLike<number>
		try {
			bytes = statement.encode(this)
		} catch (error) {
			// Later labels must not move because this fragment failed.
			this.dot += size
			throw error
		}
		if (bytes.length !== size) throw new RangeError(`Fragment encoded ${bytes.length} bytes, not ${size}`)
		const emitter = this.emitter!
		const layer = this.layers[this.section]
		const address = this.wrap(this.dot)
		if (address + size <= (this.config.addressModulus ?? Infinity)) {
			emitter.emitBytes(address, bytes, statement.provenance, layer)
		} else {
			for (let index = 0; index < size; index++) emitter.emit(this.wrap(this.dot + index), bytes[index], statement.provenance, layer)
		}
		this.dot += size
		if (emitter.count > this.config.limits.maxBytes) {
			throw new AssemblyError(`Assembly emits more than ${this.config.limits.maxBytes} bytes`, this.source)
		}
	}

	private origin(address: number, at: Position) {
		const { addressBase = 0, addressLimit, fractionalOrigins } = this.config.limits
		const valid = fractionalOrigins ? Number.isFinite(address) : Number.isSafeInteger(address)
		if (!valid || address < addressBase || address > addressLimit) {
			throw new AssemblyError(`Location ${address} is outside the address space`, at)
		}
		if (!this.config.originMayDecrease && address < this.dot) {
			throw new AssemblyError(`It is illegal to set . to a value lower than its current value (current value: ${this.dot}; new value: ${address})`, at)
		}
		this.dot = address
	}

	private emit(expr: Expr, size: number, at: Position) {
		this.reserve(size, at)
		if (!this.emitting) {
			this.dot += size
			return
		}
		const value = this.config.checkValue(this.value(expr, true)!, size, at)
		const provenance = this.provenance()
		for (let index = 0; index < size; index++) {
			const shift = 8 * (this.config.littleEndian ? index : size - 1 - index)
			this.write(Math.floor(value / 2 ** shift), provenance)
		}
	}

	private invoke(name: string, args: readonly Expr[], at: Position) {
		const values = args.map((arg) => this.value(arg, this.emitting))
		const macro = this.macros.resolve(name, values.length, at)
		const { macroDepth, macroExpansions } = this.config.limits
		if (this.frames.length >= macroDepth) throw new AssemblyError(`Macro expansion exceeds ${macroDepth} levels (is ${name} recursive?)`, at)
		if (++this.expansions > macroExpansions) throw new AssemblyError(`Macro expansion exceeds ${macroExpansions} invocations`, at)
		const scope = new SymbolScope(this.scope)
		macro.parameters.forEach((parameter, index) => scope.assign(parameter, values[index]))
		const outerScope = this.scope
		const outerInstruction = this.instruction
		this.frames.push({ macro: name, invocation: location(at), definition: location(macro.at) })
		if (!outerInstruction && this.config.isInstructionMacro(macro)) {
			this.instruction = { kind: 'instruction', source: this.source, expansion: this.frames.slice() }
		}
		this.scope = scope
		try {
			for (const statement of macro.body) this.execute(statement)
		} catch (error) {
			if (!(error instanceof AssemblyError)) throw error
			if (!this.faultFrames.has(error)) this.faultFrames.set(error, this.frames.map((frame) => frame.macro))
			if (this.frames.length > 1) throw error
			// Report at the outermost invocation, naming where the fault arose.
			throw new AssemblyError(`${error.message} (expanding ${describeChain(this.faultFrames.get(error)!)})`, at)
		} finally {
			this.scope = outerScope
			this.instruction = outerInstruction
			this.frames.pop()
		}
	}

	private provenance(): Provenance {
		return this.instruction ?? (this.data ??= { kind: 'data', source: this.source, expansion: this.frames.slice() })
	}

	private reserve(size: number, at: Position) {
		if (this.dot + size > this.config.limits.addressLimit) {
			throw new AssemblyError('Assembly passes the end of the address space', at)
		}
	}

	private wrap(address: number): number {
		const modulus = this.config.addressModulus
		return modulus === undefined ? address : ((address % modulus) + modulus) % modulus
	}

	private fill(count: number, at: Position) {
		this.reserve(count, at)
		for (let index = 0; index < count; index++) this.write(0, null)
	}

	private write(byte: number, provenance: Provenance | null) {
		const emitter = this.emitter
		if (this.emitting && emitter) {
			emitter.emit(this.wrap(this.dot), byte, provenance, this.layers[this.section])
			if (emitter.count > this.config.limits.maxBytes) {
				throw new AssemblyError(`Assembly emits more than ${this.config.limits.maxBytes} bytes`, this.source)
			}
		}
		this.dot += 1
	}
}

function describeChain(names: readonly string[]): string {
	const shown = names.length > 6 ? [...names.slice(0, 3), '...', ...names.slice(-2)] : names
	return shown.join(' > ')
}
