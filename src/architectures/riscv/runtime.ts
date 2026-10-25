import { RamInspector } from '../../core/ramInspector'
import { snapshotEffects } from '../../core/historyView'
import { TeachingConsole, recordIntegerInput } from '../../core/environments/teachingConsole'
import { HistoryText } from '../../core/historyCursor'
import { notifyHistorySeek } from '../../core/observer'
import { capturedHistoryEdit } from '../../core/editTransaction'
import { MemoryEdits } from '../../core/memoryEdits'
import type { ExecutionObserver } from '../../core/observer'
import { ExecutionController } from '../../core/executionController'
import type {
	CallFrame,
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
import * as fp from './float'
import { RiscvHistory, type RiscvRecord, type SavedState } from './history'
import type { RiscvAssembly } from './program'

const infoCache = new Map<number, InstructionInfo>()
export const instructionSet: InstructionSet = {
	encodings: ['R', 'I', 'S', 'B', 'U', 'J', 'C', 'R4'],
	registerNames: ABI,
	describe(value) {
		const d = value as Instruction
		let info = infoCache.get(d.word)
		if (!info) {
			const load = (d.opcodeWord & 127) === 3 || (d.opcodeWord & 127) === 7,
				branch = d.format === 'B',
				jump = d.name === 'jal' || d.name === 'jalr'
			info = {
				mnemonic: d.compressedName ?? d.name,
				category: branch ? 2 : jump ? 1 : load || d.format === 'S' ? 3 : ['ecall', 'ebreak'].includes(d.name) ? 5 : 0,
				encoding: this.encodings.indexOf(d.size === 2 ? 'C' : d.format),
				reads: d.float ? integerOperands(d, 6) : d.name === 'ecall' ? [17, 10] : (d.format === 'R' || d.format === 'S' || branch
					? [d.rs1, d.rs2]
					: d.format === 'I'
						? [d.rs1]
						: []
				).filter((r) => r !== 0),
				writes: d.float ? integerOperands(d, 1) : d.name === 'ecall' ? [10] : d.format === 'S' || branch || ['ecall', 'ebreak', 'fence'].includes(d.name) || d.rd === 0 ? [] : [d.rd],
				isLoad: load,
				isBranch: branch,
				isJump: jump
			}
			if (infoCache.size > 4096) infoCache.clear()
			infoCache.set(d.word, info)
		}
		return info
	},
	decodeExecuted: (entry) => (entry.kind === 'edit' ? null : decode((entry as RiscvRecord).word, true, 64))
}
/** Integer registers among the operands in `mask` (1 rd, 2 rs1, 4 rs2); CSR immediates are not registers. */
function integerOperands(d: Instruction, mask: number): number[] {
	const { fp: float, uses } = d.float!,
		immediate = d.name.startsWith('csr') && d.rm > 4
	return [d.rd, d.rs1, d.rs2].filter((r, i) => mask & uses & ~float & (1 << i) && r !== 0 && !(immediate && i === 1))
}
const isaName = (program: RiscvAssembly) =>
	`RV32IM${program.flen ? 'F' : ''}${program.flen === 64 ? 'D' : ''}${program.compressed ? 'C' : ''}`
const CANONICAL_SINGLE = 0x7fc00000

/** Flat, bounded, little-endian educational RV32IM execution environment, with optional F and D. */
export class RiscvRuntime implements Machine {
	readonly registers = new Int32Array(32)
	/** f0-f31 as low/high word pairs; the high words stay zero without D. */
	readonly fregs = new Int32Array(64)
	/** frm in bits 7:5, accrued flags in 4:0. */
	fcsr = 0
	readonly memory = new Uint8Array(MEMORY_BYTES)
	private readonly view = new DataView(this.memory.buffer)
	readonly history: RiscvHistory
	readonly observers: ExecutionObserver[] = []
	readonly breakpoints = new Set<number>()
	callStack: CallFrame[] = []
	readonly historyFormat: HistoryFormatter
	onProgress: (() => void) | null = null
	pc = 0
	private cpuHalted = false
	get stopReason() { return this.execution.reason(this.cpuHalted) }
	get halted() { return this.cpuHalted || this.execution.stopped }
	set halted(value: boolean) { this.cpuHalted = value }
	paused = false
	instructionCount = 0
	console = ''
	private readonly teachingConsole = new TeachingConsole({ integer: 1, character: 11, string: 4, exit: [10, 93] }, {
		argument: () => this.registers[10],
		write: text => { this.console += text },
		read: address => { this.range(address, 1); return this.memory[address] },
		stringLimit: () => this.memory.length + 1,
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
		fregs: this.fregs,
		fcsr: 0
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
		region: () => this.disposed ? null : ({ start: 0, end: 0 + this.memory.length - 1 }),
		read: (address) => this.memory[address - 0],
		commit: (address, bytes) => {
			this.edit(() => {
				for (let i = 0; i < bytes.length; i++) this.put(address + i, bytes[i])
			})
			return true
		},
	})

	constructor(
		readonly program: RiscvAssembly,
		options: MachineOptions
	) {
		this.history = new RiscvHistory(options.historyLimit, program.flen > 0)
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
				entry.kind === 'edit' ? '' : disassemble((entry as RiscvRecord).word, entry.address, program.compressed, program.flen),
			effects: (entry, applied) => snapshotEffects(this.history.log, this.historyCursor, entry.id, applied, 32, effects => {
				effects.registers('registers', 32, 1, 31, r => this.registers[r], (r, value) => ({ subject: `x${r}`, register: `x${r}`, value }))
				if (program.flen) {
					effects.registers('fregs', 64, 0, 64, r => this.fregs[r], (r, value) => {
						const id = `f${r >> 1}${r & 1 ? '.hi' : ''}`
						return { subject: id, register: id, value }
					})
					effects.registers('fcsr', 1, 0, 1, () => this.fcsr, (_r, value) => ({ subject: 'fcsr', register: 'fcsr', value }))
				}
				effects.memory('address', 'value')
				effects.text('outputLength', this.console.length, this.history.timeline.ahead ? this.outputText.text : this.console)
				effects.halted(this.cpuHalted)
			})
		}
	}
	get pendingInput() {
		return this.waiting && !this.halted ? { type: 'integer' as const, prompt: 'ECALL read integer (a7=5)' } : null
	}
	get historyCursor() {
		return this.history.timeline.index
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
		state.halted = this.cpuHalted
		state.outputLength = this.console.length
		state.pending = this.waiting
		state.fcsr = this.fcsr
		return state
	}
	private moveHistory(forward = false): boolean {
		if (forward && !this.history.timeline.ahead) return false
		if (!this.history.timeline.ahead) this.outputText.text = this.console
		const moved = this.history.undo(this.restore, (address, value) => {
			const old = this.memory[address - 0]
			this.memory[address - 0] = value
			return old
		}, this.saved(), this.callStack, forward)
		if (moved && forward) notifyHistorySeek(this.observers, this.instructionCount)
		return moved
	}
	private restore = (s: SavedState) => {
		this.pc = s.pc
		this.instructionCount = s.count
		this.registers.set(s.registers)
		this.halted = s.halted
		this.console = this.outputText.exchange(this.console, s.outputLength)
		if (s.frameAction === 1) this.callStack.pop()
		else if (s.frameAction === 2 && s.frame) this.callStack.push(s.frame)
		this.waiting = s.pending
		if (s.fcsr !== undefined) this.fcsr = s.fcsr
	}
	private put(address: number, value: number) {
		this.history.memory(address, this.memory[address])
		this.memory[address] = value & 255
	}
	private instruction() {
		this.aligned(this.pc, this.program.compressed ? 2 : 4)
		const half = this.view.getUint16(this.pc, true)
		if (this.program.compressed && (half & 3) !== 3) return decode(half, true, this.program.flen)
		this.range(this.pc, 4)
		return decode(this.view.getUint32(this.pc, true), this.program.compressed, this.program.flen)
	}
	step() {
		if (this.disposed) return
		if (this.moveHistory(true)) return
		if (this.halted || this.waiting) return
		let captured = false
		try {
			const d = this.instruction()
			if (!d.name)
				throw new Error(`Illegal ${isaName(this.program)} instruction 0x${d.word.toString(16)}`)
			if (d.name === 'ecall' && this.registers[17] === 5) {
				this.waiting = true
				return
			}
			this.history.begin(this.saved(), d.word)
			captured = true
			this.execute(d)
			this.registers[0] = 0
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
		if (d.float) result = this.float(d, a, imm)
		else switch (d.name) {
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
				const service = this.registers[17]
				if (!this.teachingConsole.dispatch(service)) throw new Error(`Unsupported educational ECALL ${service}`)
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
	/** Bits of a single operand: an improperly NaN-boxed value reads as the canonical NaN. */
	private single(r: number): bigint {
		return BigInt((this.program.flen === 64 && this.fregs[r * 2 + 1] !== -1 ? CANONICAL_SINGLE : this.fregs[r * 2]) >>> 0)
	}
	private double(r: number): bigint {
		return (BigInt(this.fregs[r * 2 + 1] >>> 0) << 32n) | BigInt(this.fregs[r * 2] >>> 0)
	}
	private setSingle(r: number, bits: bigint | number) {
		this.fregs[r * 2] = Number(bits) | 0
		this.fregs[r * 2 + 1] = this.program.flen === 64 ? -1 : 0
	}
	private setDouble(r: number, bits: bigint) {
		this.fregs[r * 2] = Number(bits & 0xffffffffn) | 0
		this.fregs[r * 2 + 1] = Number(bits >> 32n) | 0
	}
	/** F, D and CSR operations; returns the integer result for rd, if any. */
	private float(d: Instruction, a: number, imm: number): number | undefined {
		const name = d.name,
			obs = this.observers
		if (name.startsWith('csr')) {
			const csr = imm & 0xfff,
				old = csr === 1 ? this.fcsr & 31 : csr === 2 ? this.fcsr >>> 5 : this.fcsr,
				source = d.rm > 4 ? d.rs1 : a,
				kind = d.rm & 3,
				value = kind === 1 ? source : kind === 2 ? old | source : old & ~source
			if (csr === 1) this.fcsr = (this.fcsr & ~31) | (value & 31)
			else if (csr === 2) this.fcsr = (this.fcsr & 31) | ((value & 7) << 5)
			else this.fcsr = value & 0xff
			return old
		}
		if (name === 'flw' || name === 'fld' || name === 'fsw' || name === 'fsd') {
			const address = (a + imm) >>> 0,
				size = name.endsWith('w') ? 4 : 8
			this.aligned(address, size)
			if (name.startsWith('fl')) {
				const low = this.view.getInt32(address, true)
				if (size === 4) this.setSingle(d.rd, low)
				else {
					this.fregs[d.rd * 2] = low
					this.fregs[d.rd * 2 + 1] = this.view.getInt32(address + 4, true)
				}
				for (const o of obs) o.onMemoryRead?.(address, size)
			} else {
				const low = this.fregs[d.rs2 * 2]
				for (let i = 0; i < size; i++) this.put(address + i, (i < 4 ? low : this.fregs[d.rs2 * 2 + 1]) >>> (8 * (i & 3)))
				for (const o of obs) o.onMemoryWrite?.(address, size, low)
			}
			return undefined
		}
		const env: fp.FloatEnv = { rm: 0, flags: 0 }
		if (d.float!.rounding) {
			env.rm = d.rm === 7 ? this.fcsr >>> 5 : d.rm
			if (env.rm > 4) throw new Error(`Illegal rounding mode ${env.rm} in frm for ${name}`)
		}
		const double = name.endsWith('.d'),
			f = double ? fp.DOUBLE : fp.SINGLE,
			read = (r: number) => (double ? this.double(r) : this.single(r)),
			write = (bits: bigint) => (double ? this.setDouble(d.rd, bits) : this.setSingle(d.rd, bits))
		const operation = name.slice(0, name.lastIndexOf('.'))
		let result: number | undefined
		switch (name === 'fmv.x.w' || name === 'fmv.w.x' || name.startsWith('fcvt.') ? name : operation) {
			case 'fadd':
			case 'fsub':
				write(fp.add(env, f, read(d.rs1), read(d.rs2), operation === 'fsub'))
				break
			case 'fmul':
				write(fp.multiply(env, f, read(d.rs1), read(d.rs2)))
				break
			case 'fdiv':
				write(fp.divide(env, f, read(d.rs1), read(d.rs2)))
				break
			case 'fsqrt':
				write(fp.squareRoot(env, f, read(d.rs1)))
				break
			case 'fmadd':
			case 'fmsub':
			case 'fnmsub':
			case 'fnmadd':
				write(fp.fusedMultiplyAdd(env, f, read(d.rs1), read(d.rs2), read(d.rs3), operation.startsWith('fn'), operation.endsWith('add') === operation.startsWith('fn')))
				break
			case 'fsgnj':
			case 'fsgnjn':
			case 'fsgnjx':
				write(fp.injectSign(f, read(d.rs1), read(d.rs2), d.rm as 0 | 1 | 2))
				break
			case 'fmin':
			case 'fmax':
				write(fp.minMax(env, f, read(d.rs1), read(d.rs2), operation === 'fmax'))
				break
			case 'feq':
			case 'flt':
			case 'fle':
				result = fp.compare(env, f, read(d.rs1), read(d.rs2), operation.slice(1) as 'eq' | 'lt' | 'le')
				break
			case 'fclass':
				result = fp.classify(read(d.rs1), f)
				break
			case 'fmv.x.w':
				result = this.fregs[d.rs1 * 2]
				break
			case 'fmv.w.x':
				this.setSingle(d.rd, a)
				break
			case 'fcvt.w.s':
			case 'fcvt.wu.s':
			case 'fcvt.w.d':
			case 'fcvt.wu.d':
				result = fp.toInteger(env, f, read(d.rs1), name.includes('wu'))
				break
			case 'fcvt.s.w':
			case 'fcvt.s.wu':
				this.setSingle(d.rd, fp.fromInteger(env, fp.SINGLE, name.endsWith('wu') ? a >>> 0 : a))
				break
			case 'fcvt.d.w':
			case 'fcvt.d.wu':
				this.setDouble(d.rd, fp.fromInteger(env, fp.DOUBLE, name.endsWith('wu') ? a >>> 0 : a))
				break
			case 'fcvt.s.d':
				this.setSingle(d.rd, fp.convert(env, fp.DOUBLE, fp.SINGLE, this.double(d.rs1)))
				break
			case 'fcvt.d.s':
				this.setDouble(d.rd, fp.convert(env, fp.SINGLE, fp.DOUBLE, this.single(d.rs1)))
				break
		}
		this.fcsr |= env.flags
		return result
	}
	provideInput(input: string) {
		if (!this.waiting || this.disposed) return false
		return recordIntegerInput(input, 32, {
			begin: () => { this.history.begin(this.saved(), 0x73) },
			accept: value => {
				for (const o of this.observers) o.onInstruction?.(this.pc, decode(0x73), this.instructionCount)
				this.registers[10] = value
				this.waiting = false
				this.pc += 4
				this.instructionCount++
			},
			close: () => { this.history.close() },
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
		if (this.disposed || this.halted) return
		const d = this.execution.inspectInstruction(() => this.instruction())
		if ((d.name === 'jal' || d.name === 'jalr') && (d.rd === 1 || d.rd === 5)) {
			const target = this.pc + d.size
			await this.execution.stepOver(target)
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
			begin: () => this.history.begin(this.saved(), 0, true),
			close: () => { this.history.close() },
			undo: () => { this.moveHistory() },
			branch: () => { this.history.timeline.branch() },
		})
	}
	setProgramCounter(address: number) {
		if (!this.execution.canEdit(address)) return
		this.aligned(address, this.program.compressed ? 2 : 4)
		this.edit(() => {
			this.pc = address
			this.halted = false
			this.waiting = false
		})
		this.execution.stopped = false
	}
	registerValues(): Registers {
		const values: Registers = { ...Object.fromEntries(Array.from(this.registers, (value, i) => [`x${i}`, value])), PC: this.pc }
		if (this.program.flen) {
			for (let i = 0; i < 32; i++) {
				values[`f${i}`] = this.fregs[i * 2]
				if (this.program.flen === 64) values[`f${i}.hi`] = this.fregs[i * 2 + 1]
			}
			Object.assign(values, { fcsr: this.fcsr, frm: this.fcsr >>> 5, fflags: this.fcsr & 31 })
		}
		return values
	}
	writeRegister(id: string, value: RegisterValue) {
		if (!this.execution.canEdit(value) || !Number.isInteger(Number(value))) return false
		const index = /^x(\d+)$/.exec(id)
		if (id === 'PC') {
			try {
				this.setProgramCounter(Number(value))
				return true
			} catch {
				return false
			}
		}
		const float = /^f([0-9]|[12][0-9]|3[01])(\.hi)?$/.exec(id)
		if (this.program.flen && float && (!float[2] || this.program.flen === 64)) {
			const r = +float[1]
			return this.edit(() => {
				// A single typed into the low word is NaN-boxed; the high word is written on its own.
				if (float[2]) this.fregs[r * 2 + 1] = Number(value) | 0
				else this.setSingle(r, Number(value))
			})
		}
		if (this.program.flen && (id === 'fcsr' || id === 'frm' || id === 'fflags')) {
			const bits = Number(value)
			return this.edit(() => {
				if (id === 'fcsr') this.fcsr = bits & 0xff
				else if (id === 'frm') this.fcsr = (this.fcsr & 31) | ((bits & 7) << 5)
				else this.fcsr = (this.fcsr & ~31) | (bits & 31)
			})
		}
		if (!index || +index[1] <= 0 || +index[1] >= 32) return false
		return this.edit(() => {
			this.registers[+index[1]] = Number(value)
		})
	}
	inspectMemory(): MemoryInspector {
		return new RamInspector(this.memory, { wordBytes: 4, littleEndian: true })
	}

	writeByte(address: number, value: number) {
		if (!this.execution.canEdit(value) || !Number.isSafeInteger(address) || address < 0) return false
		if (address >= MEMORY_BYTES) return false
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
		return { addressing: { instructionBytes: this.program.compressed ? 2 : 4, memoryWordBytes: 4 }, delayedBranching: false, instructions: instructionSet, history: this.history }
	}
	dispose() {
		this.disposed = true
		this.execution.dispose(() => {
			this.observers.length = 0
			this.history.log.clear()
		})
	}
}
