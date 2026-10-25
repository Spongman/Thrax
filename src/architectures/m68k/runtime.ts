import { RamInspector } from '../../core/ramInspector'
import { instructionSetFor } from './instructions'
import { snapshotEffects } from '../../core/historyView'
import { notifyHistorySeek } from '../../core/observer'
import { capturedHistoryEdit } from '../../core/editTransaction'
import { MemoryEdits } from '../../core/memoryEdits'
import { ExecutionController } from '../../core/executionController'
import type {
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
import { describe80 } from './extended'
import { fpRegister, FPCR_MASK, FPSR_MASK, setRegister } from './fpu'
import { FPCR, FP_WORDS } from './fpuIsa'
import { FP_CONTROL_NAMES, FP_NAMES } from './profile'

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
	private readonly historyCommands = this.execution.historyCommands({
		history: () => this.history, cursor: () => this.historyCursor,
		undo: () => !this.disposed && this.cpu.undo(),
		after: () => notifyHistorySeek(this.observers, this.instructionCount),
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
		this.cpu = new M68kCpu(program.model, options.historyLimit, program.coprocessor)
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
							this.cpu.model,
							this.fpu
						)
					)
				} catch {
					return 'illegal'
				}
			},
			effects: (entry, applied) => snapshotEffects(this.history.log, this.historyCursor, entry.id, applied, 32, effects => {
				effects.registers('registers', 16, 0, 16, r => this.cpu.registers[r], (r, value) => ({ subject: REGISTER_NAMES[r], register: REGISTER_NAMES[r], value }))
				if (effects.before('sr') !== effects.after('sr', this.cpu.sr)) effects.add({ subject: 'CCR', register: 'CCR', value: effects.before('sr') & 31 })
				if (this.fpu) {
					const word = (i: number) => effects.before('fp', i, FP_WORDS) >>> 0,
						changed = (i: number) => word(i) !== effects.after('fp', this.cpu.fp[i], i, FP_WORDS) >>> 0
					for (let r = 0; r < 8; r++) if (changed(r * 3) || changed(r * 3 + 1) || changed(r * 3 + 2)) {
						const raw = (BigInt(word(r * 3) >>> 16) << 64n) | (BigInt(word(r * 3 + 1)) << 32n) | BigInt(word(r * 3 + 2))
						effects.add({ subject: FP_NAMES[r], register: FP_NAMES[r], text: describe80(raw) })
					}
					FP_CONTROL_NAMES.forEach((name, i) => { if (changed(FPCR + i)) effects.add({ subject: name, register: name, value: word(FPCR + i) }) })
				}
				effects.memory('address', 'value', address => `[$${address.toString(16)}]`)
				effects.text('outputLength', this.cpu.output.length, this.cpu.fullOutput)
				effects.halted(this.cpu.halted)
			})
		}
	}
	get fpu() {
		return this.cpu.coprocessor !== 'none'
	}
	get pc() {
		return this.cpu.pc
	}
	get stopReason() { return this.execution.reason(this.cpu.halted) }
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
		if (this.halted || this.disposed) return
		try { this.cpu.step() }
		catch (error) { this.execution.recordFault(error); throw error }
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
		const d = this.execution.inspectInstruction(() => this.cpu.decode())
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
	stepBack(): boolean {
		return this.historyCommands.stepBack()
	}
	rewindTo(id: number): boolean {
		return this.historyCommands.rewindTo(id)
	}
	private edit(change: () => void): boolean {
		if (this.disposed) return false
		return capturedHistoryEdit(change, {
			begin: () => this.history.begin(this.cpu.saved()),
			close: () => { this.history.log.close() },
			undo: () => { this.cpu.undo() },
			branch: () => { this.history.timeline.branch() },
		})
	}
	setProgramCounter(address: number) {
		if (!this.execution.canEdit(address)) return
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
			...Object.fromEntries(['C', 'V', 'Z', 'N', 'X'].map((name, bit) => [name, (this.cpu.sr >> bit) & 1])),
			...(this.fpu ? {
				...Object.fromEntries(FP_NAMES.map((name, i) => [name, fpRegister(this.cpu.fp, i)])),
				...Object.fromEntries(FP_CONTROL_NAMES.map((name, i) => [name, this.cpu.fp[FPCR + i] >>> 0]))
			} : {})
		}
	}
	writeRegister(id: string, value: RegisterValue) {
		const fpIndex = this.fpu ? FP_NAMES.indexOf(id) : -1
		if (fpIndex >= 0) {
			if (!this.execution.canEdit(value)) return false
			let raw: bigint
			try { raw = BigInt(value) } catch { return false }
			if (raw < 0n || raw >= 1n << 80n) return false
			return this.edit(() => setRegister(this.cpu.fp, fpIndex, raw))
		}
		const control = this.fpu ? FP_CONTROL_NAMES.indexOf(id) : -1
		if (control >= 0) {
			if (!this.execution.canEdit(value) || !Number.isInteger(Number(value))) return false
			return this.edit(() => { this.cpu.fp[FPCR + control] = Number(value) & [FPCR_MASK, FPSR_MASK, -1][control] })
		}
		if (!this.execution.canEdit(value) || !Number.isInteger(Number(value))) return false
		const number = Number(value)
		if (id === 'PC') {
			try {
				this.setProgramCounter(number)
				return true
			} catch {
				return false
			}
		}
		if (id === 'CCR') {
			return this.edit(() => {
				this.cpu.sr = 0x2000 | (number & 31)
			})
		}
		const flag = ['C', 'V', 'Z', 'N', 'X'].indexOf(id)
		if (flag >= 0) {
			return this.edit(() => {
				this.cpu.sr = (this.cpu.sr & ~(1 << flag)) | ((number & 1) << flag)
			})
		}
		const register = id === 'SP' ? 15 : REGISTER_NAMES.indexOf(id)
		if (register < 0) return false
		return this.edit(() => {
			this.cpu.registers[register] = number
		})
	}
	inspectMemory(): MemoryInspector {
		return new RamInspector(this.cpu.memory, { wordBytes: 2, littleEndian: false })
	}

	writeByte(address: number, value: number) {
		if (!this.execution.canEdit(value) || !Number.isSafeInteger(address) || address < 0) return false
		if (address >= MEMORY_BYTES) return false
		return this.edit(() => this.cpu.putByte(address, value))
	}
	insertByte(address: number, limit: number, value: number): boolean {
		if (!this.execution.canEdit(value)) return false
		return this.memoryEdits.insert(address, limit, value)
	}
	deleteByte(address: number, limit: number): boolean {
		if (!this.execution.canEdit(address)) return false
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
		this.execution.dispose(() => {
			this.observers.length = 0
			this.history.log.clear()
		})
	}
}
