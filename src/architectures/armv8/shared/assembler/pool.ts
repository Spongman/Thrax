/**
 * Literal pools for `LDR rd, =value`.  A value MOV or MVN can build is
 * loaded with one; any other takes a word of the pool the next `.ltorg` (or
 * LTORG, or the end of the section) lays out, reached PC-relative.
 *
 * Sizes must not change between the engine's passes, so the choice is made in
 * the layout pass, with what is known there, and kept: a value defined later
 * in the source goes to the pool even when it would have fitted a MOV.  Equal
 * values, or equal expressions where the value is not yet known, share a word.
 */

import { StatementKind, type FragmentStatement, type HookContext, type Statement } from '../../../../core/assembly/assembler'
import type { Provenance } from '../../../../core/assembly/emitter'
import type { Expr } from '../../../../core/assembly/expressions'
import { location } from '../../../../core/assembly/macroEngine'
import type { Position } from '../../../../core/assembly/tokens'
import { AssemblyError } from '../../../../core/diagnostics'
import { encodeImmediate } from '../a32/isa'
import { word32 } from './syntax'

const { Align, Hook, Fragment } = StatementKind

export class LiteralPool {
	private entries: { key: string, expr: Expr, at: Position }[] = []
	/** Where the pool starts, as the layout pass placed it. */
	address = -1

	/** Forgets the entries, before a layout pass makes them again. */
	reset() {
		this.entries = []
		this.address = -1
	}

	/** The word index holding `expr`, added when it is new. */
	slot(key: string, expr: Expr, at: Position): number {
		const index = this.entries.findIndex((entry) => entry.key === key)
		if (index >= 0) return index
		this.entries.push({ key, expr, at })
		return this.entries.length - 1
	}

	/** Address of word `index`, once laid out. */
	addressOf(index: number): number {
		return this.address + 4 * index
	}

	/** Aligns, notes the address, and lays the words out. */
	statements(at: Position): Statement[] {
		const provenance: Provenance = { kind: 'data', source: location(at), expansion: [] }
		const entries = () => this.entries
		const words: FragmentStatement = {
			kind: Fragment,
			// Chosen in layout, after the loads before it have taken their slots.
			size: () => entries().length * 4,
			encode(context) {
				const bytes: number[] = []
				for (const entry of entries()) {
					const value = word32(context.value(entry.expr, true)!, entry.at)
					bytes.push(value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, value >>> 24)
				}
				return bytes
			},
			provenance,
			at,
		}
		return [
			{ kind: Align, boundary: null, at },
			{ kind: Hook, run: (context) => { if (!context.emitting) this.address = context.dot }, at },
			words,
		]
	}
}

/** How one `LDR rd, =value` loads its value. */
export const LITERAL_MOV = 1
export const LITERAL_MVN = 2
export const LITERAL_POOL = 3

export class LiteralSite {
	kind = 0
	/** MOV or MVN's immediate field, or the pool word's index. */
	field = 0

	constructor(readonly pool: LiteralPool, readonly expr: Expr, readonly key: string, readonly at: Position) {}

	/** Run in both passes; decides in the layout pass. */
	prepare(context: HookContext) {
		if (context.emitting) return
		const value = context.value(this.expr, false)
		if (value !== undefined) {
			const word = word32(value, this.at)
			const direct = encodeImmediate(word)
			if (direct >= 0) {
				this.kind = LITERAL_MOV
				this.field = direct
				return
			}
			const inverted = encodeImmediate(~word)
			if (inverted >= 0) {
				this.kind = LITERAL_MVN
				this.field = inverted
				return
			}
		}
		this.kind = LITERAL_POOL
		this.field = this.pool.slot(value === undefined ? `=${this.key}` : `#${value >>> 0}`, this.expr, this.at)
	}

	/** The PC-relative offset of the pool word from an LDR at `address`. */
	offsetFrom(address: number): number {
		if (this.pool.address < 0) throw new AssemblyError('No literal pool follows this load', this.at)
		const offset = this.pool.addressOf(this.field) - (address + 8)
		if (offset < -4095 || offset > 4095) throw new AssemblyError(`The literal pool is ${offset} bytes away, out of LDR's reach; place .ltorg (LTORG) nearer`, this.at)
		return offset
	}
}
