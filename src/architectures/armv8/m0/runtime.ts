import { RamInspector } from '../../../core/ramInspector'
import { REGISTER_IDS, describe } from './instructions'
import { snapshotEffects } from '../../../core/historyView'
import { TeachingConsole, recordIntegerInput } from '../../../core/environments/teachingConsole'
import { HistoryText } from '../../../core/historyCursor'
import { notifyHistorySeek } from '../../../core/observer'
import { capturedHistoryEdit } from '../../../core/editTransaction'
import { MemoryEdits } from '../../../core/memoryEdits'
/** Thread-mode ARMv6-M teaching machine. Faults are atomic; NVIC/exception entry is not emulated. */
import type { ExecutionObserver } from '../../../core/observer'
import { ExecutionController } from '../../../core/executionController'
import {
	addWithCarry,
	alu,
	conditionPassed,
	multiplyFlags,
	shiftByImmediate,
	shiftByRegister,
	shifter,
} from '../shared/a32/alu'
import { FLAG_C, FLAG_V, FLAG_N, FLAG_Z } from '../shared/a32/isa'
import type {
	CallFrame,
	DescribedEffect,
	HistoryFormatter,
	Machine,
	MachineOptions,
	MemoryInspector,
	Registers,
	RegisterValue,
} from '../../contracts'
import { M0History, type M0Record, type SavedState } from './history'
import { decode, disassemble, sign, TEXT_BASE, type Instruction } from './isa'
import type { M0Program } from './program'

export { REGISTER_IDS, describe } from './instructions'

export class M0Runtime implements Machine {
	/** R0..R15, APSR, MSP, PSP, CONTROL, PRIMASK, event register. */
	readonly registers = new Int32Array(22)
	readonly memory: Uint8Array
	private readonly view: DataView
	readonly history: M0History
	readonly observers: ExecutionObserver[] = []
	readonly breakpoints = new Set<number>()
	readonly callStack: CallFrame[] = []
	readonly historyFormat: HistoryFormatter
	onProgress: (() => void) | null = null
	private cpuHalted = false
	get stopReason() { return this.execution.reason(this.cpuHalted) }
	get halted() { return this.cpuHalted || this.execution.stopped }
	set halted(value: boolean) { this.cpuHalted = value }
	paused = false
	instructionCount = 0
	console = ''
	private readonly teachingConsole = new TeachingConsole({ integer: 1, character: 11, string: 4, exit: [0] }, {
		argument: () => this.registers[0],
		write: text => { this.console += text },
		read: address => { this.range(address, 1); return this.memory[address - TEXT_BASE] },
		stringLimit: () => this.memory.length,
		halt: () => { this.halted = true },
	})
	private readonly outputText = new HistoryText()
	private waiting = false
	private disposed = false
	private speed: number | null
	private paced: ReadonlySet<number> | null = null
	private readonly snapshot: SavedState = {
		pc: 0,
		count: 0,
		registers: this.registers,
		halted: false,
		outputLength: 0,
		pending: false,
	}
	private readonly execution = new ExecutionController(this, {
		speed: () => this.speed,
		pacedAddresses: () => this.paced,
		depth: () => this.callStack.length,
		ready: () => !this.waiting || this.history.timeline.ahead,
	})
	private readonly historyCommands = this.execution.historyCommands({
		history: () => this.history, cursor: () => this.historyCursor,
		undo: () => !this.disposed && this.moveHistory(),
		after: () => notifyHistorySeek(this.observers, this.instructionCount),
	})

	private readonly memoryEdits = new MemoryEdits({
		region: () => this.disposed ? null : ({ start: TEXT_BASE, end: TEXT_BASE + this.memory.length - 1 }),
		read: (address) => this.memory[address - TEXT_BASE],
		commit: (address, bytes) => {
			this.edit(() => {
				for (let i = 0; i < bytes.length; i++) this.put(address + i, bytes[i])
			})
			return true
		},
	})

	constructor(
		readonly program: M0Program,
		memoryBytes: number,
		options: MachineOptions,
	) {
		this.memory = new Uint8Array(memoryBytes)
		this.view = new DataView(this.memory.buffer)
		this.history = new M0History(options.historyLimit)
		this.speed = options.speed
		for (const s of program.image().sections) {
			this.range(s.address, s.bytes.length)
			this.memory.set(s.bytes, s.address - TEXT_BASE)
		}
		this.pc = (program.image().entryAddress ?? TEXT_BASE) & ~1
		this.registers[13] = this.registers[17] = (TEXT_BASE + memoryBytes) & ~7
		this.registers[18] = this.registers[13]
		this.historyFormat = {
			instruction: (entry) => (entry.kind === 'edit' ? 'Edit' : this.formatHistory(entry as M0Record)),
			effects: (entry, applied) => this.effects(entry.id, applied),
		}
	}
	get pc() {
		return this.registers[15] >>> 0
	}
	set pc(value: number) {
		this.registers[15] = value
	}
	get flags() {
		return this.registers[16]
	}
	set flags(value: number) {
		this.registers[16] = value & 0xf0000000
	}
	get pendingInput() {
		return this.waiting && !this.halted ? { type: 'integer' as const, prompt: 'SVC #5: read integer' } : null
	}
	get historyCursor() {
		return this.history.timeline.index
	}
	private saved() {
		const s = this.snapshot
		s.pc = this.pc
		s.count = this.instructionCount
		s.halted = this.cpuHalted
		s.outputLength = this.console.length
		s.pending = this.waiting
		return s
	}
	private moveHistory(forward = false): boolean {
		if (forward && !this.history.timeline.ahead) return false
		if (!this.history.timeline.ahead) this.outputText.text = this.console
		const moved = this.history.undo(this.restore, (address, value) => {
			const old = this.memory[address - TEXT_BASE]
			this.memory[address - TEXT_BASE] = value
			return old
		}, this.saved(), this.callStack, forward)
		if (moved && forward) notifyHistorySeek(this.observers, this.instructionCount)
		return moved
	}
	private restore = (s: SavedState) => {
		this.registers.set(s.registers)
		this.pc = s.pc
		this.instructionCount = s.count
		this.halted = s.halted
		this.console = this.outputText.exchange(this.console, s.outputLength)
		this.waiting = s.pending
		if (s.frameAction === 1) this.callStack.pop()
		else if (s.frameAction === 2 && s.frame) this.callStack.push(s.frame)
	}
	private range(address: number, size: number) {
		if (!Number.isInteger(address) || address < TEXT_BASE || address + size > TEXT_BASE + this.memory.length)
			throw new Error(`Cortex-M0 memory/peripheral address 0x${(address >>> 0).toString(16)} is unavailable`)
	}
	private aligned(address: number, size: number) {
		this.range(address, size)
		if (address % size)
			throw new Error(`Unaligned Cortex-M0 ${size}-byte access at 0x${address.toString(16)}`)
	}
	private half(address: number) {
		this.aligned(address, 2)
		return this.view.getUint16(address - TEXT_BASE, true)
	}
	private instruction() {
		const first = this.half(this.pc),
			wide = first >= 0xe800
		return decode(first, wide ? this.half(this.pc + 2) : 0)
	}
	private operand(n: number, address: number) {
		return n === 15 ? (address + 4) | 0 : this.registers[n]
	}
	private nz(value: number, carry?: number) {
		this.flags =
			(value < 0 ? FLAG_N : 0) |
			(value === 0 ? FLAG_Z : 0) |
			(carry === undefined ? this.flags & FLAG_C : carry ? FLAG_C : 0) |
			(this.flags & FLAG_V)
	}
	private load(address: number, size: number, signed = false) {
		this.aligned(address, size)
		const p = address - TEXT_BASE,
			value =
				size === 4 ? this.view.getInt32(p, true) : size === 2 ? this.view.getUint16(p, true) : this.memory[p]
		for (const o of this.observers) o.onMemoryRead?.(address, size)
		return signed ? sign(value, size * 8) : value
	}
	private put(address: number, value: number) {
		this.history.memory(address, this.memory[address - TEXT_BASE], value & 255)
		this.memory[address - TEXT_BASE] = value & 255
	}
	private store(address: number, size: number, value: number) {
		this.aligned(address, size)
		for (let n = 0; n < size; n++) this.put(address + n, value >>> (n * 8))
		for (const o of this.observers) o.onMemoryWrite?.(address, size, value)
	}
	private branch(target: number, exchange: boolean) {
		if (exchange && !(target & 1))
			throw new Error('Cortex-M0 cannot enter ARM state: branch target bit 0 must be 1')
		const address = target & ~1
		if (address >>> 0 >= 0xffffffe0) throw new Error('Exception return is not implemented')
		this.aligned(address >>> 0, 2)
		this.pc = address
	}
	private returned(target: number) {
		if (this.callStack[this.callStack.length - 1]?.returnAddress === (target & ~1))
			this.history.frame(false, this.callStack.pop()!)
	}
	step() {
		if (this.disposed) return
		if (this.moveHistory(true)) return
		if (this.halted || this.waiting) return
		let captured = false
		try {
			const i = this.instruction(),
				address = this.pc
			if (i.name === 'svc' && i.imm === 5) {
				this.waiting = true
				return
			}
			this.history.begin(this.saved(), (i.word | (i.second << 16)) >>> 0)
			captured = true
			for (const o of this.observers) o.onInstruction?.(address, i, this.instructionCount)
			this.pc += i.size
			this.execute(i, address)
			this.registers[13] &= ~3
			this.registers[this.registers[19] & 2 ? 18 : 17] = this.registers[13]
			this.instructionCount++
			this.history.close()
		} catch (error) {
			if (captured) {
				this.history.close()
				this.moveHistory()
				this.history.timeline.branch()
				notifyHistorySeek(this.observers, this.instructionCount)
			}
			this.execution.recordFault(error)
			throw error
		}
	}
	private execute(i: Instruction, address: number) {
		const a = this.operand(i.n, address),
			b = this.operand(i.m, address),
			d = i.d,
			name = i.name
		if (i.format === 'branch' || i.format === 'conditional') {
			const target = (address + 4 + i.imm) >>> 0,
				taken = i.format !== 'conditional' || conditionPassed(i.n, this.flags)
			if (taken) {
				this.branch(target, false)
				if (name === 'bl') {
					this.registers[14] = (address + 4) | 1
					this.history.frame(true)
					this.callStack.push({ callAddress: address, returnAddress: address + 4, targetAddress: target })
				}
			}
			if (i.format === 'conditional') for (const o of this.observers) o.onBranch?.(address, taken, target)
			return
		}
		if (i.format === 'exchange') {
			const target = b
			this.branch(target, true)
			if (name === 'blx') {
				this.registers[14] = (address + 2) | 1
				this.history.frame(true)
				this.callStack.push({ callAddress: address, returnAddress: address + 2, targetAddress: this.pc })
			} else this.returned(target)
			return
		}
		if (['memimm', 'memreg', 'literal'].includes(i.format)) {
			const base = i.format === 'literal' ? (address + 4) & ~3 : a,
				at = (base + (i.format === 'memreg' ? b : i.imm)) >>> 0,
				size = name.endsWith('b') ? 1 : name.endsWith('h') ? 2 : 4
			if (name.startsWith('ldr'))
				this.registers[d] = this.load(at, size, name === 'ldrsb' || name === 'ldrsh')
			else this.store(at, size, this.registers[d])
			return
		}
		if (i.format === 'list' || i.format === 'multiple') {
			const members = Array.from({ length: 16 }, (_, n) => n).filter((n) => i.list & (1 << n)),
				count = members.length,
				load = name === 'pop' || name === 'ldmia'
			let at = name === 'push' ? this.registers[13] - count * 4 : name === 'pop' ? this.registers[13] : a
			this.aligned(at >>> 0, 4)
			this.range(at >>> 0, count * 4)
			if (name === 'push') this.registers[13] = at
			for (const n of members) {
				if (load) {
					const value = this.load(at >>> 0, 4)
					if (n === 15) {
						this.branch(value, true)
						this.returned(value)
					} else this.registers[n] = value
				} else this.store(at >>> 0, 4, this.registers[n])
				at += 4
			}
			if (name === 'pop') this.registers[13] = at
			else if (i.format === 'multiple' && (!load || !(i.list & (1 << i.n)))) this.registers[i.n] = at
			return
		}
		if (i.format === 'special') {
			if (([13, 15].includes(i.d) && name === 'mrs') || ([13, 15].includes(i.m) && name === 'msr'))
				throw new Error('Unpredictable special-register transfer')
			if (name === 'mrs') this.registers[d] = this.special(i.imm)
			else this.writeSpecial(i.imm, b)
			return
		}
		if (i.format === 'system') {
			if (name === 'cpsid' || name === 'cpsie') {
				this.registers[20] = +(name === 'cpsid')
			} else if (name === 'sev') this.registers[21] = 1
			else if (name === 'wfe') {
				if (this.registers[21]) this.registers[21] = 0
				else throw new Error('WFE waits for an external event; event delivery is not implemented')
			} else if (name === 'wfi') throw new Error('WFI requires interrupt delivery, which is not implemented')
			return
		}
		if (i.format === 'trap') {
			if (name === 'bkpt') {
				this.halted = true
				return
			}
			if (name === 'udf') throw new Error('Undefined instruction')
			this.svc(i.imm)
			return
		}
		if (i.format === 'shift') {
			const value = shiftByImmediate(
				a,
				['lsls', 'lsrs', 'asrs'].indexOf(name),
				i.imm,
				(this.flags >>> 29) & 1,
			)
			this.registers[d] = value
			this.nz(value, shifter.carry)
			return
		}
		if (i.format === 'high') {
			const value = name === 'add' ? a + b : b
			if (name === 'cmp') {
				addWithCarry(a, ~b, 1)
				this.flags = alu.flags
			} else if (d === 15) this.branch(value, false)
			else this.registers[d] = value
			return
		}
		if (i.format === 'address' || i.format === 'sp') {
			this.registers[d] = (i.n === 15 ? (address + 4) & ~3 : a) + (name === 'sub' ? -i.imm : i.imm)
			return
		}
		if (i.format === 'unary') {
			this.registers[d] =
				name === 'sxtb'
					? sign(b, 8)
					: name === 'sxth'
						? sign(b, 16)
						: name === 'uxtb'
							? b & 255
							: name === 'uxth'
								? b & 65535
								: name === 'rev'
									? ((b & 255) << 24) | ((b & 0xff00) << 8) | ((b >>> 8) & 0xff00) | (b >>> 24)
									: name === 'rev16'
										? ((b & 0xff00ff) << 8) | ((b >>> 8) & 0xff00ff)
										: sign(((b & 255) << 8) | ((b >>> 8) & 255), 16)
			return
		}
		const operand = ['imm3', 'imm8'].includes(i.format) ? i.imm : b
		let result: number
		if (['adds', 'subs', 'cmp', 'adcs', 'sbcs', 'cmn', 'rsbs'].includes(name)) {
			const subtract = ['subs', 'cmp', 'sbcs'].includes(name)
			result =
				name === 'rsbs'
					? addWithCarry(0, ~operand, 1)
					: addWithCarry(
							a,
							subtract ? ~operand : operand,
							['adcs', 'sbcs'].includes(name) ? (this.flags >>> 29) & 1 : subtract ? 1 : 0,
						)
			this.flags = alu.flags
		} else if (['lsls', 'lsrs', 'asrs', 'rors'].includes(name)) {
			result = shiftByRegister(
				a,
				['lsls', 'lsrs', 'asrs', 'rors'].indexOf(name),
				operand,
				(this.flags >>> 29) & 1,
			)
			this.nz(result, shifter.carry)
		} else {
			result =
				name === 'movs'
					? operand
					: name === 'ands' || name === 'tst'
						? a & operand
						: name === 'eors'
							? a ^ operand
							: name === 'orrs'
								? a | operand
								: name === 'bics'
									? a & ~operand
									: name === 'mvns'
										? ~operand
										: name === 'muls'
											? Math.imul(a, operand)
											: 0
			if (name === 'muls') this.flags = multiplyFlags(result, this.flags)
			else this.nz(result)
		}
		if (!['cmp', 'cmn', 'tst'].includes(name)) this.registers[d] = result
	}
	private special(spec: number) {
		if ([0, 1, 2, 3].includes(spec)) return this.flags
		if (spec === 5) return 0
		if (spec === 6 || spec === 7) return 0
		if ([8, 9, 16, 20].includes(spec))
			return this.registers[spec === 8 ? 17 : spec === 9 ? 18 : spec === 16 ? 20 : 19]
		throw new Error('Unsupported ARMv6-M special register')
	}
	private writeSpecial(spec: number, value: number) {
		if ([0, 1, 2, 3].includes(spec)) {
			this.flags = value
			return
		}
		if ([5, 6, 7].includes(spec)) return
		if (![8, 9, 16, 20].includes(spec)) throw new Error('Special register is read-only or unsupported')
		if (spec === 20) {
			this.registers[this.registers[19] & 2 ? 18 : 17] = this.registers[13]
			this.registers[19] = value & 2
			this.registers[13] = this.registers[value & 2 ? 18 : 17]
		} else if (spec === 16) this.registers[20] = value & 1
		else {
			const bank = spec === 8 ? 17 : 18
			this.registers[bank] = value & ~3
			if (bank === (this.registers[19] & 2 ? 18 : 17)) this.registers[13] = value & ~3
		}
	}
	/** Teaching ABI: SVC 0 halt, 1 integer, 4 NUL string, 5 integer input, 11 character; R0 holds argument/result. */
	private svc(service: number) {
		if (!this.teachingConsole.dispatch(service))
			throw new Error(`Unsupported teaching SVC #${service}; hardware exception delivery is not implemented`)
	}
	provideInput(text: string) {
		if (!this.waiting || this.disposed) return false
		return recordIntegerInput(text, 32, {
			begin: () => { this.history.begin(this.saved(), 0xdf05) },
			accept: value => {
				for (const o of this.observers) o.onInstruction?.(this.pc, decode(0xdf05), this.instructionCount)
				this.registers[0] = value
				this.waiting = false
				this.pc += 2
				this.instructionCount++
			},
			close: () => { this.history.close() },
		})
	}
	private formatHistory(entry: M0Record) {
		try {
			return disassemble(decode(entry.word & 65535, entry.word >>> 16), entry.address)
		} catch {
			return ''
		}
	}
	private effects(id: number, applied: boolean): DescribedEffect[] {
		return snapshotEffects(this.history.log, this.historyCursor, id, applied, 32, effects => {
			effects.registers('registers', 22, 0, 21, n => this.registers[n], (n, value) => ({ subject: REGISTER_IDS[n], register: REGISTER_IDS[n], value: value >>> 0 }))
			effects.memory('address', 'value')
			effects.text('outputLength', this.console.length, this.history.timeline.ahead ? this.outputText.text : this.console)
			effects.halted(this.cpuHalted)
		})
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
		if (this.halted || this.disposed) return
		const i = this.execution.inspectInstruction(() => this.instruction())
		if (i.name === 'bl' || i.name === 'blx') {
			const next = this.pc + i.size
			await this.execution.stepOver(next)
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
		return capturedHistoryEdit(() => {
			change()
			this.registers[this.registers[19] & 2 ? 18 : 17] = this.registers[13]
		}, {
			begin: () => this.history.begin(this.saved(), 0, true),
			close: () => { this.history.close() },
			undo: () => { this.moveHistory() },
			branch: () => { this.history.timeline.branch() },
		})
	}
	setProgramCounter(address: number) {
		if (!this.execution.canEdit(address)) return
		this.aligned(address, 2)
		this.edit(() => {
			this.pc = address
			this.halted = false
			this.waiting = false
		})
		this.execution.stopped = false
	}
	registerValues(): Registers {
		const out: Registers = {}
		for (let n = 0; n < 21; n++) out[REGISTER_IDS[n]] = this.registers[n] >>> 0
		for (const [name, bit] of Object.entries({ N: 31, Z: 30, C: 29, V: 28 }))
			out[name] = (this.flags >>> bit) & 1
		out.XPSR = (this.flags | (1 << 24)) >>> 0
		return out
	}
	writeRegister(id: string, value: RegisterValue) {
		if (!this.execution.canEdit(value)) return false
		if (
			typeof value !== 'number' ||
			value < -2147483648 ||
			value > 0xffffffff
		)
			return false
		const n = REGISTER_IDS.indexOf(id)
		if (n < 0 || n >= 21) return false
		if (n === 15) {
			try {
				this.setProgramCounter(value)
			} catch {
				return false
			}
			return true
		}
		return this.edit(() => {
			if (n === 16) this.flags = value
			else if (n >= 17) this.writeSpecial(n === 17 ? 8 : n === 18 ? 9 : n === 19 ? 20 : 16, value)
			else this.registers[n] = n === 13 ? value & ~3 : value
		})
	}
	inspectMemory(): MemoryInspector {
		return new RamInspector(this.memory, { wordBytes: 2, littleEndian: true, base: TEXT_BASE })
	}

	writeByte(address: number, value: number) {
		if (!this.execution.canEdit(value) || !Number.isSafeInteger(address) || address < 0) return false
		try {
			this.range(address, 1)
		} catch {
			return false
		}
		return this.edit(() => this.put(address, value))
	}
	insertByte(address: number, limit: number, value: number): boolean {
		if (!this.execution.canEdit(value)) return false
		return this.memoryEdits.insert(address, limit, value)
	}
	deleteByte(address: number, limit: number): boolean {
		if (!this.execution.canEdit(address)) return false
		return this.memoryEdits.delete(address, limit)
	}
	configure(o: { speed?: number | null; pacedAddresses?: ReadonlySet<number> | null }) {
		if (o.speed !== undefined) this.speed = o.speed
		if (o.pacedAddresses !== undefined) this.paced = o.pacedAddresses
	}
	addBreakpoint(a: number) {
		this.breakpoints.add(a)
	}
	removeBreakpoint(a: number) {
		this.breakpoints.delete(a)
	}
	getBreakpoints() {
		return this.breakpoints
	}
	toolConfig() {
		return {
			addressing: { instructionBytes: 2, memoryWordBytes: 4 }, delayedBranching: false,
			history: this.history,
			instructions: {
				encodings: ['Thumb16', 'Thumb32'],
				registerNames: REGISTER_IDS,
				describe: (value: unknown) => describe(value as Instruction),
				decodeExecuted: (entry: M0Record) =>
					entry.kind === 'edit' ? null : decode(entry.word & 65535, entry.word >>> 16),
			},
		}
	}
	dispose() {
		this.disposed = true
		this.execution.dispose(() => {
			this.observers.length = 0
			this.history.log.clear()
		})
	}
}
