/**
 * Memory reference visualization: a grid heat map of memory addresses.
 *
 * Every data access lands in one grid cell, chosen by its address relative to
 * a base and a configurable words-per-cell span; the cell's running count is
 * what the panel colours.  This is a heat map of *addresses*, unlike the
 * execution profile, which heat-maps *source lines*.
 *
 * A grid heat map of memory accesses.  Reads and writes are not distinguished
 * from writes - processMIPSUpdate (:202-205) increments on any AccessNotice -
 * so both hooks feed the same counter here.
 */

import type { ExecutionObserver, MachineConfig } from '../core/observer'
import { Replay, type Replayable } from './replay'
import { StepLog } from './stepLog'

/** Low end of a reference-count range, and the colour shown for it. */
export interface ColorStop {
	count: number
	color: string
}

export interface MemoryReferenceSettings {
	/** Address of grid cell [0][0]. */
	baseAddress: number
	/** Memory words represented by one grid cell. */
	wordsPerUnit: number
	rows: number
	columns: number
	/** Rendering only: cell size on screen. Ignored by the accumulator. */
	unitPixelWidth: number
	unitPixelHeight: number
	/**
	 * Count-to-colour ramp, ascending, first entry's count always 0: the
	 * colour for a count is the highest stop at or below it.
	 *
	 */
	colorRamp: ColorStop[]
}

/** Defaults: static data base, 1 word/unit, a 16x16 grid of 16px cells. */
export const DEFAULT_MEMORY_REFERENCE_SETTINGS: MemoryReferenceSettings = {
	baseAddress: 0x10010000,
	wordsPerUnit: 1,
	rows: 16,
	columns: 16,
	unitPixelWidth: 16,
	unitPixelHeight: 16,
	colorRamp: [
		{ count: 0, color: '#000000' },
		{ count: 1, color: '#0000ff' },
		{ count: 2, color: '#00ff00' },
		{ count: 3, color: '#ffff00' },
		{ count: 5, color: '#ffc800' },
		{ count: 10, color: '#ff0000' },
	],
}

export interface MemoryReferenceSnapshot {
	settings: MemoryReferenceSettings
	rows: number
	columns: number
	/** Access count per cell, row-major, length rows*columns. */
	counts: number[]
	/** The hottest cell's count, 0 when nothing has landed yet. */
	max: number
}

const isCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0
const isAddress = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff
const isHexColor = (value: unknown) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

function isColorStop(value: unknown): value is ColorStop {
	if (typeof value !== 'object' || value === null) return false
	const stop = value as ColorStop
	return typeof stop.count === 'number' && Number.isInteger(stop.count) && stop.count >= 0 && isHexColor(stop.color)
}

/** Settings validator for the tool registry: defaults, ranges, and a sane ramp. */
export function isMemoryReferenceSettings(value: unknown): value is MemoryReferenceSettings {
	if (typeof value !== 'object' || value === null) return false
	const settings = value as MemoryReferenceSettings
	if (!isAddress(settings.baseAddress)) return false
	if (!isCount(settings.wordsPerUnit) || !isCount(settings.rows) || !isCount(settings.columns)) return false
	if (!isCount(settings.unitPixelWidth) || !isCount(settings.unitPixelHeight)) return false
	if (!Array.isArray(settings.colorRamp) || settings.colorRamp.length === 0) return false
	if (!settings.colorRamp.every(isColorStop)) return false
	if (settings.colorRamp[0].count !== 0) return false
	for (let index = 1; index < settings.colorRamp.length; index++) {
		if (settings.colorRamp[index].count <= settings.colorRamp[index - 1].count) return false
	}
	return true
}

/**
 * The colour for `count` under `colorRamp`: the highest stop whose count is
 * at or below it. Ramp is assumed ascending with a count-0 first entry, which
 * isMemoryReferenceSettings enforces.
 */
export function colorForCount(count: number, colorRamp: ColorStop[]): string {
	let color = colorRamp[0]?.color ?? '#000000'
	for (const stop of colorRamp) {
		if (count < stop.count) break
		color = stop.color
	}
	return color
}

export class MemoryReferenceVisualizer implements ExecutionObserver, Replayable {
	private settings: MemoryReferenceSettings
	private counts: number[] = []
	private max = 0
	/**
	 * The addresses reached, in order.  A load works its address out from
	 * registers as it runs, so the machine's log of what ran does not say where
	 * it went; with this the run can be counted into the grid again, which is
	 * how the grid follows a step back.
	 */
	private readonly reached = new StepLog<number>()
	private readonly replay = new Replay(this)

	onInstruction(_address: number, _decoded: unknown, instructionCount = 0) {
		this.replay.watch(instructionCount)
		// Running on from a step back leaves a future that did not happen, and
		// the machine's history drops the oldest instructions as it fills.
		this.reached.dropFrom(instructionCount)
		const oldest = this.replay.oldest
		if (oldest !== undefined) this.reached.dropBefore(oldest)
	}

	onSeek(to: number) {
		this.replay.seek(to)
	}

	onConfigure(machine: MachineConfig) {
		this.replay.configure(machine)
	}

	replayStep(_address: number, _decoded: unknown, instructionCount: number) {
		for (let index = this.reached.indexFrom(instructionCount); this.reached.countAt(index) === instructionCount; index++) {
			this.count(this.reached.valueAt(index)!)
		}
	}

	constructor(settings: MemoryReferenceSettings = DEFAULT_MEMORY_REFERENCE_SETTINGS) {
		this.settings = settings
		this.configure(settings)
	}

	configure(settings: MemoryReferenceSettings) {
		this.settings = settings
		// A different grid over the same accesses, so it is counted again rather
		// than emptied.
		this.replay.rework()
	}

	/** Everything counted from the accesses, which a replay redoes. */
	clear() {
		this.counts = new Array(this.settings.rows * this.settings.columns).fill(0)
		this.max = 0
	}

	reset() {
		this.clear()
		this.reached.clear()
		this.replay.reset()
	}

	onReset() {
		this.reset()
	}

	onMemoryRead(address: number, _size: number) {
		this.access(address)
	}

	onMemoryWrite(address: number, _size: number) {
		this.access(address)
	}

	/**
	 * One access, counted into whichever cell its unit falls in; an address
	 * outside the grid is dropped, matching Grid.incrementElement returning -1
	 * for an out-of-range row or column.
	 */
	private access(address: number) {
		this.reached.record(this.replay.at - 1, address)
		this.count(address)
	}

	/** One access into the grid, live or replayed. */
	private count(address: number) {
		const index = this.indexFor(address)
		if (index < 0) return
		const count = ++this.counts[index]
		if (count > this.max) this.max = count
	}

	/**
	 * Grid cell for `address`, or -1 when it falls before the base address or
	 * outside the grid's rows/columns.
	 * (offset), :800 (bounds check)
	 */
	private indexFor(address: number): number {
		const { baseAddress, wordsPerUnit, rows, columns } = this.settings
		const diff = (address >>> 0) - (baseAddress >>> 0)
		if (diff < 0) return -1
		// Two truncating integer divisions: bytes to words, then words to units.
		const wordOffset = Math.floor(diff / 4)
		const unit = Math.floor(wordOffset / wordsPerUnit)
		const row = Math.floor(unit / columns)
		const col = unit % columns
		if (row >= rows || col >= columns) return -1
		return row * columns + col
	}

	snapshot(): MemoryReferenceSnapshot {
		this.replay.settle()
		return {
			settings: this.settings,
			rows: this.settings.rows,
			columns: this.settings.columns,
			counts: [...this.counts],
			max: this.max,
		}
	}
}
