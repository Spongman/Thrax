import type { ExecutionObserver } from '../../core/observer'
import { yieldToHost } from '../../core/yieldToHost'
import type {
	CallFrame,
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
import { ABI, decode, disassemble, MEMORY_BYTES, signed, type Instruction } from './isa'
import { RiscvHistory, type RiscvRecord, type SavedState } from './history'
import type { RiscvAssembly } from './program'

const infoCache = new Map<number, InstructionInfo>()
export const instructionSet: InstructionSet = {
	encodings: ['R', 'I', 'S', 'B', 'U', 'J', 'C'],
	registerNames: ABI,
	describe(value) {
		const d = value as Instruction
		let info = infoCache.get(d.word)
		if (!info) {
			const load = (d.opcodeWord & 127) === 3,
				branch = d.format === 'B',
				jump = d.name === 'jal' || d.name === 'jalr'
			info = {
				mnemonic: d.compressedName ?? d.name,
				category: branch ? 2 : jump ? 1 : load || d.format === 'S' ? 3 : ['ecall', 'ebreak'].includes(d.name) ? 5 : 0,
				encoding: this.encodings.indexOf(d.size === 2 ? 'C' : d.format),
				reads: (d.format === 'R' || d.format === 'S' || branch
					? [d.rs1, d.rs2]
					: d.format === 'I'
						? [d.rs1]
						: []
				).filter((r) => r !== 0),
				writes: [d.format === 'S' || branch || ['ecall', 'ebreak', 'fence'].includes(d.name) || d.rd === 0 ? -1 : d.rd].filter(r => r >= 0),
				isLoad: load,
				isBranch: branch,
				isJump: jump
			}
			if (infoCache.size > 4096) infoCache.clear()
			infoCache.set(d.word, info)
		}
		return info
	},
	decodeExecuted: (entry) => (entry.kind === 'edit' ? null : decode((entry as RiscvRecord).word, true))
}

/** Flat, bounded, little-endian educational RV32IM execution environment. */
export class RiscvRuntime implements Machine {
	readonly registers = new Int32Array(32)
	readonly memory = new Uint8Array(MEMORY_BYTES)
	private readonly view = new DataView(this.memory.buffer)
	readonly history: RiscvHistory
	readonly observers: ExecutionObserver[] = []
	readonly breakpoints = new Set<number>()
	callStack: CallFrame[] = []
	readonly historyFormat: HistoryFormatter
	onProgress: (() => void) | null = null
	pc = 0
	halted = false
	paused = false
	instructionCount = 0
	console = ''
	private waiting = false
	private running = false
	private disposed = false
	private speed: number | null
	private paced: ReadonlySet<number> | null = null
	private readonly snapshot: SavedState = {
		pc: 0,
		count: 0,
		registers: this.registers,
		halted: false,
		outputLength: 0,
		pending: false
	}
	constructor(
		readonly program: RiscvAssembly,
		options: MachineOptions
	) {
		this.history = new RiscvHistory(options.historyLimit)
		this.speed = options.speed
		const image = program.image()
		for (const section of image.sections) {
			this.range(section.address, section.bytes.length)
			this.memory.set(section.bytes, section.address)
		}
		this.pc = image.entryAddress ?? 0x1000
		this.registers[2] = MEMORY_BYTES - 16
		this.historyFormat = {
			instruction: (entry) =>
				entry.kind === 'edit' ? '' : disassemble((entry as RiscvRecord).word, entry.address, program.compressed),
			effects: (entry, applied) => {
				const log = this.history.log,
					index = log.indexOfId(entry.id)
				if (index < 0) return []
				const pos = log.first + index,
					columns = log.entries.block(pos).buffers.columns,
					slot = pos % log.entries.capacity
				const effects: DescribedEffect[] = []
				const add = (effect: Omit<DescribedEffect, 'label' | 'applied'>) =>
					effects.push({
						...effect,
						applied,
						label: `${effect.subject} ${applied ? '→' : '←'} ${effect.text ?? effect.value ?? effect.detail ?? ''}`
					})
				const nextPos = pos + 1,
					next = index + 1 < log.length ? log.entries.block(nextPos).buffers.columns : null,
					nextSlot = nextPos % log.entries.capacity
				for (let r = 1; r < 32; r++) {
					const before = columns.registers[slot * 32 + r],
						after = next ? next.registers[nextSlot * 32 + r] : this.registers[r]
					if (before !== after) add({ subject: `x${r}`, register: `x${r}`, value: before })
				}
				for (let p = log.effectStart(index); p < log.effectStart(index) + log.effectCount(index); p++) {
					const c = log.effects.block(p).buffers.columns,
						s = p % log.effects.capacity
					add({ subject: `[0x${c.address[s].toString(16)}]`, address: c.address[s], value: c.value[s] })
				}
				const afterLength = next ? next.outputLength[nextSlot] : this.console.length
				if (columns.outputLength[slot] !== afterLength)
					add({
						subject: 'console',
						detail: JSON.stringify(this.console.slice(columns.outputLength[slot], afterLength))
					})
				if (columns.halted[slot] !== (next ? next.halted[nextSlot] : +this.halted)) add({ subject: 'halted' })
				return effects
			}
		}
	}
	get pendingInput() {
		return this.waiting && !this.halted ? { type: 'integer' as const, prompt: 'ECALL read integer (a7=5)' } : null
	}
	get historyCursor() {
		return this.history.length
	}
	private range(address: number, size: number) {
		if (!Number.isInteger(address) || address < 0 || address + size > MEMORY_BYTES)
			throw new Error(`Memory access outside RAM at 0x${(address >>> 0).toString(16)}`)
	}
	private aligned(address: number, size: number) {
		this.range(address, size)
		if (address % size) throw new Error(`Misaligned ${size}-byte access at 0x${address.toString(16)}`)
	}
	private saved(): SavedState {
		const state = this.snapshot
		state.pc = this.pc
		state.count = this.instructionCount
		state.halted = this.halted
		state.outputLength = this.console.length
		state.pending = this.waiting
		return state
	}
	private restore = (s: SavedState) => {
		this.pc = s.pc
		this.instructionCount = s.count
		this.registers.set(s.registers)
		this.halted = s.halted
		this.console = this.console.slice(0, s.outputLength)
		if (s.frameAction === 1) this.callStack.pop()
		else if (s.frameAction === 2 && s.frame) this.callStack.push(s.frame)
		this.waiting = s.pending
	}
	private put(address: number, value: number) {
		this.history.memory(address, this.memory[address])
		this.memory[address] = value & 255
	}
	private instruction() {
		this.aligned(this.pc, this.program.compressed ? 2 : 4)
		const half = this.view.getUint16(this.pc, true)
		if (this.program.compressed && (half & 3) !== 3) return decode(half, true)
		this.range(this.pc, 4)
		return decode(this.view.getUint32(this.pc, true), this.program.compressed)
	}
	step() {
		if (this.halted || this.waiting || this.disposed) return
		const d = this.instruction()
		if (!d.name)
			throw new Error(`Illegal ${this.program.compressed ? 'RV32IMC' : 'RV32IM'} instruction 0x${d.word.toString(16)}`)
		if (d.name === 'ecall' && this.registers[17] === 5) {
			this.waiting = true
			return
		}
		this.history.begin(this.saved(), d.word)
		try {
			this.execute(d)
			this.registers[0] = 0
			this.instructionCount++
			this.history.close()
		} catch (error) {
			this.history.close()
			this.history.undo(this.restore, (a, v) => {
				this.memory[a] = v
			})
			for (const o of this.observers) o.onSeek?.(this.instructionCount)
			throw error
		}
	}
	private execute(d: Instruction) {
		const oldPc = this.pc,
			a = this.registers[d.rs1],
			b = this.registers[d.rs2],
			u = a >>> 0,
			v = b >>> 0,
			imm = d.imm
		let next = (oldPc + d.size) >>> 0,
			result: number | undefined
		const obs = this.observers
		for (const o of obs) o.onInstruction?.(oldPc, d, this.instructionCount)
		switch (d.name) {
			case 'lui':
				result = imm
				break
			case 'auipc':
				result = oldPc + imm
				break
			case 'add':
				result = a + b
				break
			case 'addi':
				result = a + imm
				break
			case 'sub':
				result = a - b
				break
			case 'and':
				result = a & b
				break
			case 'andi':
				result = a & imm
				break
			case 'or':
				result = a | b
				break
			case 'ori':
				result = a | imm
				break
			case 'xor':
				result = a ^ b
				break
			case 'xori':
				result = a ^ imm
				break
			case 'sll':
				result = a << (b & 31)
				break
			case 'slli':
				result = a << imm
				break
			case 'srl':
				result = a >>> (b & 31)
				break
			case 'srli':
				result = a >>> imm
				break
			case 'sra':
				result = a >> (b & 31)
				break
			case 'srai':
				result = a >> imm
				break
			case 'slt':
				result = +(a < b)
				break
			case 'sltu':
				result = +(u < v)
				break
			case 'slti':
				result = +(a < imm)
				break
			case 'sltiu':
				result = +(u < imm >>> 0)
				break
			case 'mul':
				result = Math.imul(a, b)
				break
			case 'mulh':
				result = Number((BigInt(a) * BigInt(b)) >> 32n)
				break
			case 'mulhsu':
				result = Number((BigInt(a) * BigInt(v)) >> 32n)
				break
			case 'mulhu':
				result = Number((BigInt(u) * BigInt(v)) >> 32n)
				break
			case 'div':
				result = b === 0 ? -1 : a === -2147483648 && b === -1 ? a : Math.trunc(a / b)
				break
			case 'divu':
				result = v === 0 ? -1 : Math.floor(u / v)
				break
			case 'rem':
				result = b === 0 ? a : a % b
				break
			case 'remu':
				result = v === 0 ? u : u % v
				break
			case 'jal':
			case 'jalr': {
				next = d.name === 'jal' ? (oldPc + imm) >>> 0 : ((a + imm) & ~1) >>> 0
				this.aligned(next, this.program.compressed ? 2 : 4)
				result = oldPc + d.size
				if (d.rd === 1 || d.rd === 5) {
					this.history.frame(true)
					this.callStack.push({ callAddress: oldPc, returnAddress: result, targetAddress: next })
				} else if (
					d.name === 'jalr' &&
					(d.rs1 === 1 || d.rs1 === 5) &&
					this.callStack[this.callStack.length - 1]?.returnAddress === next
				)
					this.history.frame(false, this.callStack.pop()!)
				break
			}
			case 'beq':
			case 'bne':
			case 'blt':
			case 'bge':
			case 'bltu':
			case 'bgeu': {
				const taken =
					d.name === 'beq'
						? a === b
						: d.name === 'bne'
							? a !== b
							: d.name === 'blt'
								? a < b
								: d.name === 'bge'
									? a >= b
									: d.name === 'bltu'
										? u < v
										: u >= v
				const target = (oldPc + imm) >>> 0
				if (taken) {
					this.aligned(target, this.program.compressed ? 2 : 4)
					next = target
				}
				for (const o of obs) o.onBranch?.(oldPc, taken, target)
				break
			}
			case 'lb':
			case 'lbu':
			case 'lh':
			case 'lhu':
			case 'lw': {
				const address = (a + imm) >>> 0,
					size = d.name === 'lw' ? 4 : d.name.includes('h') ? 2 : 1
				this.aligned(address, size)
				result =
					size === 4
						? this.view.getInt32(address, true)
						: size === 2
							? this.view.getUint16(address, true)
							: this.memory[address]
				if (d.name === 'lb' || d.name === 'lh') result = signed(result, size * 8)
				for (const o of obs) o.onMemoryRead?.(address, size)
				break
			}
			case 'sb':
			case 'sh':
			case 'sw': {
				const address = (a + imm) >>> 0,
					size = d.name === 'sw' ? 4 : d.name === 'sh' ? 2 : 1
				this.aligned(address, size)
				for (let i = 0; i < size; i++) this.put(address + i, b >>> (8 * i))
				for (const o of obs) o.onMemoryWrite?.(address, size, b)
				break
			}
			case 'ecall': {
				const service = this.registers[17],
					arg = this.registers[10]
				if (service === 1) this.console += String(arg)
				else if (service === 11) this.console += String.fromCharCode(arg & 255)
				else if (service === 4) {
					let p = arg >>> 0,
						text = ''
					for (;;) {
						this.range(p, 1)
						const byte = this.memory[p++]
						if (!byte) break
						text += String.fromCharCode(byte)
					}
					this.console += text
				} else if (service === 10 || service === 93) this.halted = true
				else throw new Error(`Unsupported educational ECALL ${service}`)
				break
			}
			case 'ebreak':
				this.halted = true
				break
			case 'fence':
				break
		}
		if (result !== undefined && d.rd !== 0) this.registers[d.rd] = result
		this.pc = next
	}
	provideInput(input: string) {
		if (!this.waiting || !/^[+-]?\d+$/.test(input.trim())) return false
		const value = Number(input.trim())
		if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) return false
		this.history.begin(this.saved(), 0x73)
		for (const o of this.observers) o.onInstruction?.(this.pc, decode(0x73), this.instructionCount)
		this.registers[10] = value
		this.waiting = false
		this.pc += 4
		this.instructionCount++
		this.history.close()
		return true
	}
	private async runUntil(done: () => boolean) {
		if (this.running || this.disposed) return
		this.running = true
		this.paused = false
		try {
			let first = true
			while (this.running && !this.halted && !this.waiting && !this.disposed) {
				const start = performance.now()
				let steps = 0,
					visible = 0
				const batch = this.speed === null ? 20000 : Math.max(1, Math.ceil(this.speed / 30))
				while (
					steps < 20000 &&
					visible < batch &&
					performance.now() - start < 16 &&
					this.running &&
					!this.halted &&
					!this.waiting
				) {
					if (!first && (done() || this.breakpoints.has(this.pc))) {
						this.paused = true
						return
					}
					first = false
					const paced = !this.paced || this.paced.has(this.pc)
					this.step()
					steps++
					if (paced) visible++
				}
				this.onProgress?.()
				await yieldToHost()
				if (this.speed !== null) {
					const speed = this.speed,
						due = (visible / Math.max(1, speed)) * 1000
					let delay = due - (performance.now() - start)
					while (delay > 0 && this.running && this.speed === speed) {
						const slice = Math.min(50, delay)
						await new Promise((resolve) => setTimeout(resolve, slice))
						delay -= slice
					}
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
		if (this.disposed || this.halted) return
		const d = this.instruction()
		if ((d.name === 'jal' || d.name === 'jalr') && (d.rd === 1 || d.rd === 5)) {
			const depth = this.callStack.length,
				target = this.pc + d.size
			await this.runUntil(() => this.pc === target && this.callStack.length <= depth)
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
		this.halted = true
	}
	stepBack() {
		this.pause()
		const undone = this.history.undo(this.restore, (a, v) => {
			this.memory[a] = v
		})
		if (undone) for (const o of this.observers) o.onSeek?.(this.instructionCount)
		return undone
	}
	rewindTo(id: number) {
		const index = this.history.indexOfId(id)
		if (index < 0) return false
		while (this.history.length > index) this.stepBack()
		return true
	}
	private edit(change: () => void) {
		this.history.begin(this.saved(), 0, true)
		change()
		this.history.close()
	}
	setProgramCounter(address: number) {
		this.aligned(address, this.program.compressed ? 2 : 4)
		this.edit(() => {
			this.pc = address
			this.halted = false
			this.waiting = false
		})
	}
	registerValues(): Registers {
		return { ...Object.fromEntries(Array.from(this.registers, (value, i) => [`x${i}`, value])), PC: this.pc }
	}
	writeRegister(id: string, value: RegisterValue) {
		const index = /^x(\d+)$/.exec(id)
		if (id === 'PC') {
			this.setProgramCounter(Number(value))
			return true
		}
		if (!index || +index[1] <= 0 || +index[1] >= 32) return false
		this.edit(() => {
			this.registers[+index[1]] = Number(value)
		})
		return true
	}
	inspectMemory(): MemoryInspector {
		return {
			wordBytes: 4,
			littleEndian: true,
			byte: (a) => (a >= 0 && a < MEMORY_BYTES ? this.memory[a] : undefined),
			word: (a) => (a >= 0 && a < MEMORY_BYTES ? this.view.getUint32(a & ~3, true) : undefined)
		}
	}
	writeByte(address: number, value: number) {
		if (!Number.isInteger(address) || address < 0 || address >= MEMORY_BYTES) return false
		this.edit(() => this.put(address, value))
		return true
	}
	insertByte(address: number, limit: number, value: number) {
		if (
			!Number.isInteger(address) ||
			!Number.isInteger(limit) ||
			address < 0 ||
			limit >= MEMORY_BYTES ||
			address > limit
		)
			return false
		this.edit(() => {
			for (let a = limit; a > address; a--) this.put(a, this.memory[a - 1])
			this.put(address, value)
		})
		return true
	}
	deleteByte(address: number, limit: number) {
		if (
			!Number.isInteger(address) ||
			!Number.isInteger(limit) ||
			address < 0 ||
			limit >= MEMORY_BYTES ||
			address > limit
		)
			return false
		this.edit(() => {
			for (let a = address; a < limit; a++) this.put(a, this.memory[a + 1])
			this.put(limit, 0)
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
		return { delayedBranching: false, instructions: instructionSet, history: this.history }
	}
	dispose() {
		this.disposed = true
		this.running = false
		this.onProgress = null
		this.observers.length = 0
		this.history.log.clear()
	}
}
