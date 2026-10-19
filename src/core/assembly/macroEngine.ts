import type { SourceLocation } from '../../architectures/contracts'
import { AssemblyError, formatPosition, type SourcePosition } from '../diagnostics'
import type { Position } from './tokens'

export interface MacroDefinition<Statement> {
	name: string
	parameters: readonly string[]
	body: readonly Statement[]
	at: Position
}

/** One level of macro expansion: where it was invoked and where the macro is defined. */
export interface ExpansionFrame {
	macro: string
	invocation: SourceLocation
	definition: SourceLocation
}

export interface MacroPolicy {
	/** A later definition of the same name and arity is ignored rather than rejected. */
	keepFirst: boolean
	/** Reject a definition naming one parameter twice. */
	uniqueParameters: boolean
}

const strict: MacroPolicy = { keepFirst: false, uniqueParameters: true }

/** Macros overloaded by argument count. */
export class MacroTable<Statement> {
	private readonly byName = new Map<string, Map<number, MacroDefinition<Statement>>>()

	constructor(private readonly policy: MacroPolicy = strict) {}

	define(macro: MacroDefinition<Statement>) {
		if (this.policy.uniqueParameters) {
			const seen = new Set<string>()
			for (const parameter of macro.parameters) {
				if (seen.has(parameter)) throw new AssemblyError(`Duplicate parameter '${parameter}' in macro ${macro.name}`, macro.at)
				seen.add(parameter)
			}
		}
		let overloads = this.byName.get(macro.name)
		if (!overloads) this.byName.set(macro.name, overloads = new Map())
		const original = overloads.get(macro.parameters.length)
		if (original) {
			if (this.policy.keepFirst) return
			throw new AssemblyError(
				`Redefinition of ${macro.parameters.length}-argument macro ${macro.name} (original ${formatPosition(original.at)})`, macro.at)
		}
		overloads.set(macro.parameters.length, macro)
	}

	/** The overload for `arity`, if any. */
	find(name: string, arity: number): MacroDefinition<Statement> | undefined {
		return this.byName.get(name)?.get(arity)
	}

	resolve(name: string, arity: number, at: SourcePosition): MacroDefinition<Statement> {
		const overloads = this.byName.get(name)
		if (!overloads) throw new AssemblyError(`Macro '${name}' has not been defined`, at)
		const macro = overloads.get(arity)
		if (!macro) {
			const known = [...overloads.keys()].sort((a, b) => a - b).join(', ')
			throw new AssemblyError(`Macro '${name}' not defined for ${arity} argument${arity === 1 ? '' : 's'} (defined for ${known})`, at)
		}
		return macro
	}
}

export function location(at: Position): SourceLocation {
	return { file: at.file, line: at.line, column: at.column }
}
