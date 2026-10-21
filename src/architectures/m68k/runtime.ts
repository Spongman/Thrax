import { instructionSetFor } from './instructions'
import { describeValueEffect, textChange } from '../../core/historyView'
import { notifyHistorySeek } from '../../core/observer'
import { editTransaction } from '../../core/editTransaction'
import { rewindHistoryTo } from '../../core/historyCursor'
import { MemoryEdits } from '../../core/memoryEdits'
import { historyNeighbour } from '../../core/historyCursor'
import { ExecutionController } from '../../core/executionController'
import type {
	DescribedEffect,
	HistoryFormatter,
	Machine,
	MachineOptions,
	MemoryInspector,
	Registers,
	RegisterValue
} from '../contracts'
import { M68kCpu } from './cpu'
import { decodeInstruction, disassemble } from './decode'
import type { M68kRecord } from './history'
import { MEMORY_BYTES, REGISTER_NAMES } from './isa'
import type { M68kAssembly } from './program'

export { instructionSetFor } from './instructions'
export class M68kRuntime implements Machine {
	readonly cpu: M68kCpu
	readonly observers
	readonly history
	readonly historyFormat: HistoryFormatter
	readonly breakpoints = new Set<number>()
	onProgress: (() => void) | null = null
	paused = false
	private disposed = false
	private speed: number | null
	private paced: ReadonlySet<number> | null = null
	private readonly execution = new ExecutionController(this, {
		speed: () => this.speed,
		pacedAddresses: () => this.paced,
		depth: () => this.callStack.length,
		ready: () => !this.cpu.pending || this.history.timeline.ahead,
	})

	private readonly memoryEdits = new MemoryEdits({
		region: () => this.disposed ? null : ({ start: 0, end: 0 + this.cpu.memory.length - 1 }),
		read: (address) => this.cpu.memory[address - 0],
		commit: (address, bytes) => {
			this.edit(() => {
				for (let i = 0; i < bytes.length; i++) this.cpu.putByte(address + i, bytes[i])
			})
			return true
		},
	})

	constructor(
		readonly program: M68kAssembly,
		options: MachineOptions
	) {
		this.cpu = new M68kCpu(program.model, options.historyLimit)
		this.history = this.cpu.history
		this.observers = this.cpu.observers
		this.speed = options.speed
		for (const section of program.image().sections) {
			this.cpu.range(section.address, section.bytes.length)
			this.cpu.memory.set(section.bytes, section.address)
		}
		this.cpu.pc = program.image().entryAddress ?? 0x1000
		this.historyFormat = {
			instruction: (entry) => {
				if (entry.kind === 'edit') return ''
				const record = entry as M68kRecord
				try {
					return disassemble(
						decodeInstruction(
							(address) => record.words[(address - record.address) / 2] ?? 0,
							entry.address,
							this.cpu.model
						)
					)
				} catch {
					return 'illegal'
				}
			},
			effects: (entry, applied) => {
				const log = this.history.log,
					index = log.indexOfId(entry.id)
				if (index < 0) return []
				const position = log.first + index,
					slot = position % log.entries.capacity,
					c = log.entries.block(position).buffers.columns
				const neighbour = historyNeighbour(log, this.historyCursor, index),
					next = neighbour?.columns,
					nextSlot = neighbour?.slot ?? 0
				const effects: DescribedEffect[] = []
				const add = (effect: Omit<DescribedEffect, 'label' | 'applied'>) =>
					effects.push(describeValueEffect(applied, { ...effect }, 32))
				for (let r = 0; r < 16; r++) {
					const value = c.registers[slot * 16 + r],
						after = next ? next.registers[nextSlot * 16 + r] : this.cpu.registers[r]
					if (value !== after) add({ subject: REGISTER_NAMES[r], register: REGISTER_NAMES[r], value })
				}
				if (c.sr[slot] !== (next ? next.sr[nextSlot] : this.cpu.sr))
					add({ subject: 'CCR', register: 'CCR', value: c.sr[slot] & 31 })
				for (let p = log.effectStart(index); p < log.effectStart(index) + log.effectCount(index); p++) {
					const e = log.effects.block(p).buffers.columns,
						s = p % log.effects.capacity
					add({ subject: `[$${e.address[s].toString(16)}]`, address: e.address[s], value: e.value[s] })
				}
				const length = next ? next.outputLength[nextSlot] : this.cpu.output.length
				if (length !== c.outputLength[slot])
					add({ subject: 'console', detail: textChange(this.cpu.fullOutput, c.outputLength[slot], length) })
				if (c.halted[slot] !== (next ? next.halted[nextSlot] : +this.cpu.halted)) add({ subject: 'halted' })
				return effects
			}
		}
	}
	get pc() {
		return this.cpu.pc
	}
	get halted() {
		return this.cpu.halted || this.execution.stopped
	}
	get pendingInput() {
		return !this.halted && this.cpu.pending
			? { type: 'integer' as const, prompt: 'TRAP #15 task 5: signed integer' }
			: null
	}
	get instructionCount() {
		return this.cpu.count
	}
	get console() {
		return this.cpu.output
	}
	get callStack() {
		return this.cpu.callStack
	}
	get historyCursor() {
		return this.history.timeline.index
	}
	step() {
		if (!this.halted && !this.disposed) this.cpu.step()
	}
	provideInput(input: string) {
		return !this.disposed && this.cpu.provideInput(input)
	}
	private runUntil(done: () => boolean) {
		return this.execution.runUntil(done)
	}
	run() {
		return this.runUntil(() => false)
	}
	continue() {
		return this.run()
	}
	runTo(address: number) {
		return this.execution.runTo(address)
	}
	async stepOver() {
		if (this.halted) return
		const d = this.cpu.decode()
		if (d.name === 'jsr' || d.name === 'bsr') {
			const returnAddress = this.pc + d.length
			await this.execution.stepOver(returnAddress)
		} else this.step()
	}
	stepToReturn() {
		return this.execution.stepToReturn()
	}
	pause() { this.execution.pause() }
	stop() { this.execution.stop() }
	stepBack() {
		this.pause()
		const undone = this.cpu.undo()
		if (undone) {
			this.execution.stopped = false
			notifyHistorySeek(this.observers, this.instructionCount)
		}
		return undone
	}
	rewindTo(id: number): boolean {
		return rewindHistoryTo(this.history, () => this.historyCursor, id, () => this.cpu.undo(), () => {
			this.execution.stopped = false
			this.pause()
			notifyHistorySeek(this.observers, this.instructionCount)
		})
	}
	private edit(change: () => void) {
		if (this.disposed) return
		editTransaction(change, {
			begin: () => this.history.begin(this.cpu.saved()),
			commit: () => { this.history.log.close() },
			rollback: () => {
				this.history.log.close()
				this.cpu.undo()
				this.history.timeline.branch()
			},
		})
	}
	setProgramCounter(address: number) {
		this.cpu.range(address, 2, true)
		this.edit(() => {
			this.cpu.pc = address
			this.cpu.halted = false
			this.cpu.pending = false
			this.execution.stopped = false
		})
	}
	registerValues(): Registers {
		return {
			...Object.fromEntries(REGISTER_NAMES.map((name, i) => [name, this.cpu.registers[i]])),
			SP: this.cpu.registers[15],
			PC: this.pc,
			SR: this.cpu.sr,
			CCR: this.cpu.sr & 31,
			...Object.fromEntries(['C', 'V', 'Z', 'N', 'X'].map((name, bit) => [name, (this.cpu.sr >> bit) & 1]))
		}
	}
	writeRegister(id: string, value: RegisterValue) {
		const number = Number(value)
		if (!Number.isInteger(number)) return false
		if (id === 'PC') {
			try {
				this.setProgramCounter(number)
				return true
			} catch {
				return false
			}
		}
		if (id === 'CCR') {
			this.edit(() => {
				this.cpu.sr = 0x2000 | (number & 31)
			})
			return true
		}
		const flag = ['C', 'V', 'Z', 'N', 'X'].indexOf(id)
		if (flag >= 0) {
			this.edit(() => {
				this.cpu.sr = (this.cpu.sr & ~(1 << flag)) | ((number & 1) << flag)
			})
			return true
		}
		const register = id === 'SP' ? 15 : REGISTER_NAMES.indexOf(id)
		if (register < 0) return false
		this.edit(() => {
			this.cpu.registers[register] = number
		})
		return true
	}
	inspectMemory(): MemoryInspector {
		return {
			wordBytes: 2,
			littleEndian: false,
			byte: (address) =>
				Number.isInteger(address) && address >= 0 && address < MEMORY_BYTES ? this.cpu.memory[address] : undefined,
			word: (address) =>
				Number.isInteger(address) && address >= 0 && address < MEMORY_BYTES
					? this.cpu.view.getUint16(address & ~1, false)
					: undefined
		}
	}
	writeByte(address: number, value: number) {
		if (!Number.isInteger(address) || address < 0 || address >= MEMORY_BYTES || this.disposed) return false
		this.edit(() => this.cpu.putByte(address, value))
		return true
	}
	insertByte(address: number, limit: number, value: number): boolean {
		return this.memoryEdits.insert(address, limit, value)
	}
	deleteByte(address: number, limit: number): boolean {
		return this.memoryEdits.delete(address, limit)
	}
	configure(options: { speed?: number | null; pacedAddresses?: ReadonlySet<number> | null }) {
		if (options.speed !== undefined) this.speed = options.speed
		if (options.pacedAddresses !== undefined) this.paced = options.pacedAddresses
	}
	addBreakpoint(address: number) {
		this.breakpoints.add(address)
	}
	removeBreakpoint(address: number) {
		this.breakpoints.delete(address)
	}
	getBreakpoints() {
		return this.breakpoints
	}
	toolConfig() {
		return { addressing: { instructionBytes: 2, memoryWordBytes: 2 }, delayedBranching: false, instructions: instructionSetFor(this.cpu), history: this.history }
	}
	dispose() {
		this.disposed = true
		this.execution.dispose()
		this.execution.running = false
		this.onProgress = null
		this.observers.length = 0
		this.history.log.clear()
	}
}
