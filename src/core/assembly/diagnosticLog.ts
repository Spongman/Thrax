import { AssemblyError } from '../diagnostics'
import type { Diagnostic } from '../types'

interface Entry { diagnostic: Diagnostic; phase: number; dedupe: boolean }

export interface CollectOptions {
	/** Report every warning as an error, keeping its message and code. */
	promoteWarnings: boolean
	/** Reading order: file of first report, then line, then column. */
	sort: boolean
}

/**
 * Diagnostics gathered by numbered phase.  A dialect may discover faults out of
 * reading order, such as while encoding after layout; phases restore the order
 * a sequential assembler would have found them in before deduplication.
 */
export class DiagnosticLog {
	private readonly entries: Entry[] = []

	/** `dedupe` drops a later report of the same message on the same file and line. */
	add(diagnostic: Diagnostic, phase: number, dedupe = true) {
		this.entries.push({ diagnostic, phase, dedupe })
	}

	/** Logs a source fault; anything else is an assembler bug and propagates. */
	record(error: unknown, phase: number) {
		if (!(error instanceof AssemblyError)) throw error
		this.add(error.diagnostic, phase)
	}

	get size() {
		return this.entries.length
	}

	collect(options: CollectOptions): Diagnostic[] {
		const ordered = this.entries.map((entry, index) => ({ entry, index }))
			.sort((left, right) => (left.entry.phase - right.entry.phase) || (left.index - right.index))
		const seen = new Set<string>()
		let result: Diagnostic[] = []
		for (const { entry: { diagnostic, dedupe } } of ordered) {
			const key = `${diagnostic.message}\u0000${diagnostic.file}\u0000${diagnostic.line}`
			if (dedupe && seen.has(key)) continue
			seen.add(key)
			result.push(diagnostic)
		}
		if (options.promoteWarnings) {
			result = result.map((diagnostic) => diagnostic.severity === 'warning' ? { ...diagnostic, severity: 'error' } : diagnostic)
		}
		if (options.sort) sortByReadingOrder(result)
		return result
	}
}

function sortByReadingOrder(diagnostics: Diagnostic[]) {
	const fileOrder = new Map<string, number>()
	for (const diagnostic of diagnostics) {
		if (!fileOrder.has(diagnostic.file ?? '')) fileOrder.set(diagnostic.file ?? '', fileOrder.size)
	}
	diagnostics.sort((left, right) =>
		(fileOrder.get(left.file ?? '')! - fileOrder.get(right.file ?? '')!) ||
		((left.line ?? Infinity) - (right.line ?? Infinity)) ||
		((left.column ?? 0) - (right.column ?? 0)))
}
