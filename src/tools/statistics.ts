/**
 * Instruction statistics.
 *
 * Every executed instruction lands in exactly one category, so the counts sum
 * to the total.
 */

import { InstructionCategory, type InstructionSet } from '../architectures/contracts'
import type { ExecutionObserver, MachineConfig } from '../core/observer'
import { Replay, type Replayable } from './replay'

export type CategoryKey = 'alu' | 'jump' | 'branch' | 'memory' | 'coprocessor' | 'trap' | 'other'

/** Labels by key, in the order of the neutral categories they count. */
export const CATEGORY_LABELS: Record<CategoryKey, string> = {
	alu: 'ALU',
	jump: 'Jump',
	branch: 'Branch',
	memory: 'Memory',
	coprocessor: 'Coprocessor',
	trap: 'Trap',
	other: 'Other',
}

/** Snapshot key of each `InstructionCategory`, indexed by it. */
const CATEGORY_KEYS: readonly CategoryKey[] = (() => {
	const keys: CategoryKey[] = []
	keys[InstructionCategory.ALU] = 'alu'
	keys[InstructionCategory.JUMP] = 'jump'
	keys[InstructionCategory.BRANCH] = 'branch'
	keys[InstructionCategory.MEMORY] = 'memory'
	keys[InstructionCategory.COPROCESSOR] = 'coprocessor'
	keys[InstructionCategory.TRAP] = 'trap'
	keys[InstructionCategory.OTHER] = 'other'
	return keys
})()

export interface StatisticsSnapshot {
	total: number
	byCategory: Record<CategoryKey, number>
	/** Counts by encoding class, as the architecture names them. */
	byEncoding: Array<{ label: string; count: number }>
	/** Executed counts per mnemonic, most frequent first. */
	byMnemonic: Array<{ op: string; count: number }>
}

export class InstructionStatistics implements ExecutionObserver, Replayable {
	private total = 0
	/** Counts indexed by `InstructionCategory` and by encoding class. */
	private categories = new Array<number>(CATEGORY_KEYS.length).fill(0)
	private encodings: number[] = []
	private mnemonics = new Map<string, number>()
	/** How the architecture classifies what it hands over. */
	private instructions: InstructionSet | null = null
	/**
	 * Every count here is a tally of the instructions that ran, and the machine
	 * keeps those, so stepping back means counting them again rather than
	 * keeping a copy of the tallies for every step.
	 */
	private readonly replay = new Replay(this)

	onSeek(to: number) {
		this.replay.seek(to)
	}

	onConfigure(machine: MachineConfig) {
		this.instructions = machine.instructions ?? null
		this.replay.configure(machine)
	}

	replayStep(address: number, instruction: unknown, instructionCount: number) {
		this.count(instruction)
	}

	onInstruction(address: number, instruction: unknown, instructionCount = 0) {
		this.replay.watch(instructionCount)
		this.count(instruction)
	}

	/** One instruction counted, live or replayed. */
	private count(instruction: unknown) {
		this.total += 1
		// Nothing to classify with leaves only the total.
		if (!this.instructions) return
		const info = this.instructions.describe(instruction)
		this.categories[info.category] += 1
		this.encodings[info.encoding] = (this.encodings[info.encoding] ?? 0) + 1
		this.mnemonics.set(info.mnemonic, (this.mnemonics.get(info.mnemonic) ?? 0) + 1)
	}

	/** Everything worked out from the instructions, which a replay redoes. */
	clear() {
		this.total = 0
		this.categories.fill(0)
		this.encodings = []
		this.mnemonics.clear()
	}

	reset() {
		this.clear()
		this.replay.reset()
	}

	onReset() {
		this.reset()
	}

	snapshot(): StatisticsSnapshot {
		this.replay.settle()
		const byCategory = {} as Record<CategoryKey, number>
		CATEGORY_KEYS.forEach((key, category) => { byCategory[key] = this.categories[category] })
		const labels = this.instructions?.encodings ?? []
		return {
			total: this.total,
			byCategory,
			byEncoding: labels.map((label, encoding) => ({ label, count: this.encodings[encoding] ?? 0 })),
			byMnemonic: [...this.mnemonics.entries()]
				.map(([op, count]) => ({ op, count }))
				.sort((left, right) => right.count - left.count || left.op.localeCompare(right.op)),
		}
	}
}
