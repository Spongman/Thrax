import { yieldToHost } from '../../core/yieldToHost'
import type {
	DescribedEffect,
	HistoryFormatter,
	InstructionInfo,
	InstructionSet,
	Machine,
	MachineOptions,
	MemoryInspector,
	Registers,
	RegisterValue
} from '../contracts'
import { M68kCpu } from './cpu'
import { decodeInstruction, disassemble, type Decoded } from './decode'
import type { M68kRecord } from './history'
import { MEMORY_BYTES, REGISTER_NAMES } from './isa'
import type { M68kAssembly } from './program'

export function instructionSetFor(cpu: M68kCpu): InstructionSet {
	return {
		encodings: ['Integer'],
		registerNames: REGISTER_NAMES,
		describe(instruction) {
			const d = instruction as Decoded,
				addressOnly = ['lea', 'pea', 'jsr', 'jmp'].includes(d.name),
				readOnly = ['cmp', 'cmpi', 'cmpa', 'tst', 'btst'].includes(d.name),
				load =
					!addressOnly &&
					((d.source !== undefined && d.source.mode >= 2 && !(d.source.mode === 7 && d.source.reg === 4)) ||
						(d.destination !== undefined &&
							d.destination.mode >= 2 &&
							!['move', 'clr', 'scc', 'movesr', 'fromccr', 'movem'].includes(d.name))),
				store = !readOnly && d.destination !== undefined && d.destination.mode >= 2,
				branch = d.name === 'dbcc' || (d.condition !== undefined && d.condition >= 2),
				jump = ['jmp', 'jsr', 'rts', 'rtd'].includes(d.name) || d.name === 'bra' || d.name === 'bsr'
			const reads = new Set<number>()
			for (const operand of [d.source, d.destination])
				if (operand) {
					if (operand.mode < 2) reads.add(operand.reg + (operand.mode === 1 ? 8 : 0))
					else if (operand.mode < 7) reads.add(operand.reg + 8)
					if (operand.mode === 6 || (operand.mode === 7 && operand.reg === 3)) reads.add(operand.extension[0] >>> 12)
				}
			if (d.reg !== undefined) reads.add(d.reg)
			const info: InstructionInfo = {
				mnemonic: d.name,
				category: branch ? 2 : jump ? 1 : load || store ? 3 : d.name === 'trap' || d.name === 'bkpt' ? 5 : 0,
				encoding: 0,
				reads: [...reads],
				writes: readOnly
					? -1
					: d.destination && d.destination.mode < 2
						? d.destination.reg + (d.destination.mode === 1 ? 8 : 0)
						: d.reg !== undefined && !['cmp', 'cmpa'].includes(d.name)
							? d.reg
							: -1,
				isLoad: load,
				isBranch: branch,
				isJump: jump
			}
			return info
		},
		decodeExecuted(entry) {
			if (entry.kind === 'edit') return null
			const record = entry as M68kRecord
			try {
				return decodeInstruction(
					(address) => record.words[(address - record.address) / 2] ?? 0,
					record.address,
					cpu.model
				)
			} catch {
				return null
			}
		}
	}
}
export class M68kRuntime implements Machine {
	readonly cpu: M68kCpu
	readonly observers
	readonly history
	readonly historyFormat: HistoryFormatter
	readonly breakpoints = new Set<number>()
	onProgress: (() => void) | null = null
	paused = false
	private stopped = false
	private disposed = false
	private running = false
	private speed: number | null
	private paced: ReadonlySet<number> | null = null
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
				const nextPos = position + 1,
					nextSlot = nextPos % log.entries.capacity,
					next = index + 1 < log.length ? log.entries.block(nextPos).buffers.columns : null
				const effects: DescribedEffect[] = []
				const add = (effect: Omit<DescribedEffect, 'label' | 'applied'>) =>
					effects.push({
						...effect,
						applied,
						label: `${effect.subject} ${applied ? '→' : '←'} ${effect.value ?? effect.detail ?? ''}`
					})
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
					add({ subject: 'console', detail: JSON.stringify(this.cpu.output.slice(c.outputLength[slot], length)) })
				if (c.halted[slot] !== (next ? next.halted[nextSlot] : +this.cpu.halted)) add({ subject: 'halted' })
				return effects
			}
		}
	}
	get pc() {
		return this.cpu.pc
	}
	get halted() {
		return this.cpu.halted || this.stopped
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
		return this.history.length
	}
	step() {
		if (!this.halted && !this.disposed) this.cpu.step()
	}
	provideInput(input: string) {
		return !this.disposed && this.cpu.provideInput(input)
	}
	private async runUntil(done: () => boolean) {
		if (this.running || this.disposed) return
		this.running = true
		this.paused = false
		this.stopped = false
		try {
			let first = true
			while (this.running && !this.halted && !this.cpu.pending && !this.disposed) {
				const start = performance.now(),
					speed = this.speed,
					batch = speed === null ? 20000 : Math.max(1, Math.ceil(speed / 30))
				let steps = 0,
					visible = 0
				while (
					steps < 20000 &&
					visible < batch &&
					performance.now() - start < 16 &&
					this.running &&
					!this.halted &&
					!this.cpu.pending
				) {
					if (!first && (done() || this.breakpoints.has(this.pc))) {
						this.paused = true
						return
					}
					first = false
					const show = !this.paced || this.paced.has(this.pc)
					this.step()
					steps++
					if (show) visible++
				}
				this.onProgress?.()
				await yieldToHost()
				if (speed !== null) {
					const due = start + (visible / Math.max(1, speed)) * 1000
					while (this.running && this.speed === speed && performance.now() < due)
						await new Promise((resolve) => setTimeout(resolve, Math.min(50, due - performance.now())))
				}
			}
		} finally {
			this.running = false
		}
	}
	run() {
		return this.runUntil(() => false)
	}
	continue() {
		return this.run()
	}
	runTo(address: number) {
		return this.runUntil(() => this.pc === address)
	}
	async stepOver() {
		if (this.halted) return
		const d = this.cpu.decode()
		if (d.name === 'jsr' || d.name === 'bsr') {
			const returnAddress = this.pc + d.length,
				depth = this.callStack.length
			await this.runUntil(() => this.pc === returnAddress && this.callStack.length <= depth)
		} else this.step()
	}
	stepToReturn() {
		const depth = this.callStack.length
		return this.runUntil(() => depth > 0 && this.callStack.length < depth)
	}
	pause() {
		this.running = false
		this.paused = true
	}
	stop() {
		this.running = false
		this.stopped = true
	}
	stepBack() {
		this.pause()
		const undone = this.cpu.undo()
		if (undone) {
			this.stopped = false
			for (const observer of this.observers) observer.onSeek?.(this.instructionCount)
		}
		return undone
	}
	rewindTo(id: number) {
		const index = this.history.indexOfId(id)
		if (index < 0) return false
		while (this.history.length > index) this.stepBack()
		return true
	}
	private edit(change: () => void) {
		if (this.disposed) return
		this.history.begin(this.cpu.saved())
		try {
			change()
			this.history.log.close()
		} catch (error) {
			this.history.log.close()
			this.cpu.undo()
			throw error
		}
	}
	setProgramCounter(address: number) {
		this.cpu.range(address, 2, true)
		this.edit(() => {
			this.cpu.pc = address
			this.cpu.halted = false
			this.cpu.pending = false
			this.stopped = false
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
	insertByte(address: number, limit: number, value: number) {
		if (
			![address, limit].every(Number.isInteger) ||
			address < 0 ||
			address > limit ||
			limit >= MEMORY_BYTES ||
			this.disposed
		)
			return false
		this.edit(() => {
			for (let i = limit; i > address; i--) this.cpu.putByte(i, this.cpu.memory[i - 1])
			this.cpu.putByte(address, value)
		})
		return true
	}
	deleteByte(address: number, limit: number) {
		if (
			![address, limit].every(Number.isInteger) ||
			address < 0 ||
			address > limit ||
			limit >= MEMORY_BYTES ||
			this.disposed
		)
			return false
		this.edit(() => {
			for (let i = address; i < limit; i++) this.cpu.putByte(i, this.cpu.memory[i + 1])
			this.cpu.putByte(limit, 0)
		})
		return true
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
		return { delayedBranching: false, instructions: instructionSetFor(this.cpu), history: this.history }
	}
	dispose() {
		this.disposed = true
		this.running = false
		this.onProgress = null
		this.observers.length = 0
		this.history.log.clear()
	}
}
