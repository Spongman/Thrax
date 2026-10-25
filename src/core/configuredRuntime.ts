import type * as Monaco from 'monaco-editor'
import type { ArchitectureDefinition, AssembledProgram, CallFrame, DebugInspection, DescribedEffect, EditorHost, HistoryRecord, InstructionInfo, Machine, MachineHistory, MachineOptions, MachineProfile, MemoryInspector, Registers, RegisterValue, SourceLocation } from '../architectures/contracts'
import { InstructionCategory, RegisterFormat } from '../architectures/contracts'
import type { CpuConfiguration, CpuContext, CpuInstruction } from './configuredCpu'
import { assembleConfigured } from './assembly/configured'
import { stripAssemblyComment } from './assembly/text'
import { createArchitectureServices } from './architectureServices'
import { segmentAddress } from './addressSpace'
import { RGB32_LE } from './bitmapFormats'
import { parseIntegerInput } from './console'
import { disposableGroup } from './disposableScope'
import { capturedHistoryEdit } from './editTransaction'
import { ExecutionController } from './executionController'
import { canonicalExamples } from './exampleCatalog'
import { HistoryBufferLayout, type HistoryBufferSchema } from './historyBuffers'
import { exchangeHistoryBytes, exchangeHistoryFrame, historyNeighbour, HistoryCursor, HistoryText } from './historyCursor'
import { HistoryLog } from './historyLog'
import { describeValueEffect, historyCount, historySlice, snapshotEffects } from './historyView'
import { ImageProgram } from './imageProgram'
import { formatInstructionHelp } from './instructionHelp'
import { bitsToDouble, bitsToSingle, formatDouble, formatSingle } from './ieee754'
import { FLOAT_ENCODINGS, formatEncodedFloat } from './floatEncodings'
import { MemoryEdits } from './memoryEdits'
import { notifyHistorySeek, type ExecutionObserver, type MachineConfig } from './observer'
import { RamInspector } from './ramInspector'
import { defineSettings } from './settings'
import { registerAssemblyLanguage, registerTokenHover } from '../services/assemblyLanguage'
import { inspectAssemblyToken } from '../services/assemblyInspection'
import { escapeSymbol, findPatternDefinition, registerGotoDefinition, symbolAt } from '../services/gotoDefinition'

/** Internal byte-journal addresses occupy a disjoint half of the u32 effect space. */
const INTERNAL_STATE = 0x80000000

/** Each family explicitly selects its register cardinality and instruction width. */
export function cpuHistorySchema(spec: { registers: number, wide: boolean, instructionBytes: number }): HistoryBufferSchema {
	return {
		entry: [
			{ name: 'pc', type: 'u32', elements: 1 },
			{ name: 'controlPc', type: 'u32', elements: 1 },
			{ name: 'count', type: 'f64', elements: 1 },
			{ name: 'decodeId', type: 'f64', elements: 1 },
			{ name: 'bytes', type: 'u8', elements: spec.instructionBytes },
			{ name: 'kind', type: 'u8', elements: 1 },
			{ name: 'registers', type: 'u32', elements: spec.registers * (spec.wide ? 2 : 1) },
			{ name: 'halted', type: 'u8', elements: 1 },
			{ name: 'outputLength', type: 'u32', elements: 1 },
			{ name: 'pending', type: 'u8', elements: 1 },
			{ name: 'frameAction', type: 'u8', elements: 1 },
			{ name: 'frame', type: 'u32', elements: 3 },
		],
		effect: [{ name: 'address', type: 'u32', elements: 1 }, { name: 'value', type: 'u8', elements: 1 }],
	}
}

class ConfiguredProgram extends ImageProgram {
	readonly symbolSites: ReadonlyMap<string, ReadonlyMap<string, SourceLocation>>
	constructor(readonly config: CpuConfiguration, sources: Parameters<typeof assembleConfigured>[0], result = config.assemble?.(sources) ?? assembleConfigured(sources, config)) {
		super(sources.entries[0] ?? sources.files[0]?.name ?? 'main.asm', result.image, result.diagnostics, { instructionBytes: config.fixedInstructionBytes ?? 'mapping' })
		const globals = new Map<string, SourceLocation>()
		for (const file of sources.files) file.code.split(/\r?\n/).forEach((text, index) => {
			const line = stripAssemblyComment(text, config.comments ?? [';', '//'])
			const match = config.editor
				? config.editor.definitions('[A-Za-z_.$@#][\\w.$@#]*').map(pattern => pattern.exec(line)).find(found => found && this.labels.has(found[2]))
				: /^(\s*)([A-Za-z_.$][\w.$]*)\s*(?::|=|\s+equ\b)/i.exec(line) ?? /^(\s*\.(?:equ|set)\s+)([A-Za-z_.$][\w.$]*)/i.exec(line)
			if (match && this.labels.has(match[2])) globals.set(match[2], { file: file.name, line: index + 1, column: match[1].length + 1 })
		})
		this.symbolSites = new Map([['', globals]])
	}
}

interface CpuRecord extends HistoryRecord { decodeId: number }
interface DecodedInstruction {
	instruction: CpuInstruction
	id: number
	addresses: number[]
	bytes: Uint8Array
	pages: number[]
	versions: number[]
}
interface OverflowUndo {
	pc: number
	count: number
	halted: boolean
	pending: boolean
	outputLength: number
	registers: Uint32Array
	frames: CallFrame[]
	addresses: Uint32Array
	values: Uint8Array
	length: number
}
const INPUT_WAIT = Symbol('input wait')
const INTEGER_INPUT = Object.freeze({ type: 'integer' as const })

/** A typed column view; native instruction functions are cached once, never per step. */
class CpuHistory implements MachineHistory {
	readonly log: HistoryLog
	readonly timeline: HistoryCursor
	private nextId = 0
	private overflowUndo: OverflowUndo | null = null
	constructor(readonly cpu: ConfiguredRuntime, limit: number) {
		this.log = new HistoryLog(new HistoryBufferLayout(cpu.config.historySchema), undefined, () => this.captureOverflow())
		this.log.limit = limit
		this.timeline = new HistoryCursor(this.log)
	}
	get retention() { return this.log.retention }
	get length() { return this.log.length }
	indexOfId(id: number) { return this.log.indexOfId(id) }
	instructionCountAt(index: number) { return historyCount(this.log, index, 'count') }
	slice(from: number, to: number) { return historySlice(this, from, to) }
	at(index: number): CpuRecord | undefined {
		if (!Number.isInteger(index) || index < 0 || index >= this.length) return undefined
		const position = this.log.first + index, slot = position % this.log.entries.capacity
		const c = this.log.entries.block(position).buffers.columns
		return { id: this.log.id(index), address: c.pc[slot], instructionCount: c.count[slot], kind: c.kind[slot] ? 'edit' : 'instruction', decodeId: c.decodeId[slot] }
	}
	begin(decodeId: number, edit: boolean, instructionSize = 0) {
		this.overflowUndo = null
		this.timeline.branch()
		const cpu = this.cpu, slot = this.log.openEntryWith(this.nextId++)
		const c = this.log.entries.tail!.buffers.columns
		c.pc[slot] = c.controlPc[slot] = cpu.pc
		c.count[slot] = cpu.instructionCount
		c.decodeId[slot] = decodeId
		c.kind[slot] = +edit
		c.halted[slot] = +cpu.nativeHalted
		c.outputLength[slot] = cpu.console.length
		c.pending[slot] = +cpu.waiting
		c.frameAction[slot] = 0
		const registers = c.registers
		if (cpu.config.wideRegisters) {
			for (let i = 0; i < cpu.w.length; i++) {
				registers[slot * cpu.w.length * 2 + i * 2] = Number(cpu.w[i] & 0xffffffffn)
				registers[slot * cpu.w.length * 2 + i * 2 + 1] = Number(cpu.w[i] >> 32n)
			}
		} else if (cpu.config.readRegister) {
			for (let i = 0; i < cpu.r.length; i++) registers[slot * cpu.r.length + i] = Number(cpu.config.readRegister(cpu, i))
		} else registers.set(cpu.r, slot * cpu.r.length)
		const stride = c.bytes.length / this.log.entries.capacity
		if (instructionSize > stride) throw new Error('Native history instruction width exceeded')
		for (let i = 0; i < instructionSize; i++) c.bytes[slot * stride + i] = cpu.instructionByte(cpu.pc, i)
	}
	byte(address: number, value: number) {
		const slot = this.log.pushEffect()
		if (slot < 0) {
			const undo = this.overflowUndo
			if (undo) {
				if (undo.length === undo.addresses.length) {
					const addresses = new Uint32Array(undo.length * 2), values = new Uint8Array(undo.length * 2)
					addresses.set(undo.addresses); values.set(undo.values)
					undo.addresses = addresses; undo.values = values
				}
				undo.addresses[undo.length] = address; undo.values[undo.length++] = value
			}
			return
		}
		const c = this.log.effects.tail!.buffers.columns
		c.address[slot] = address
		c.value[slot] = value
	}
	frame(push: boolean, frame?: CallFrame) {
		if (this.log.openEntry < 0) return
		const slot = this.log.openEntry % this.log.entries.capacity, c = this.log.entries.tail!.buffers.columns
		c.frameAction[slot] = push ? 1 : 2
		if (frame) c.frame.set([frame.callAddress, frame.returnAddress, frame.targetAddress], slot * 3)
	}
	private captureOverflow() {
		if (this.log.openEntry < 0) return
		const c = this.log.entries.block(this.log.openEntry).buffers.columns
		const slot = this.log.openEntry % this.log.entries.capacity, index = this.log.length - 1
		const count = this.log.effectCount(index), capacity = Math.max(16, count * 2)
		const registers = new Uint32Array(c.registers.length / this.log.entries.capacity)
		registers.set(c.registers.subarray(slot * registers.length, (slot + 1) * registers.length))
		const frames = this.cpu.callStack.map(frame => ({ ...frame }))
		if (c.frameAction[slot] === 1) frames.pop()
		else if (c.frameAction[slot] === 2) frames.push({ callAddress: c.frame[slot * 3], returnAddress: c.frame[slot * 3 + 1], targetAddress: c.frame[slot * 3 + 2] })
		const undo: OverflowUndo = { pc: c.controlPc[slot], count: c.count[slot], halted: !!c.halted[slot], pending: !!c.pending[slot], outputLength: c.outputLength[slot], registers, frames, addresses: new Uint32Array(capacity), values: new Uint8Array(capacity), length: count }
		const start = this.log.effectStart(index)
		for (let i = 0; i < count; i++) {
			const position = start + i, effects = this.log.effects.block(position).buffers.columns, at = position % this.log.effects.capacity
			undo.addresses[i] = effects.address[at]; undo.values[i] = effects.value[at]
		}
		this.overflowUndo = undo
	}
	/** Ordinary instructions use their existing typed row; only overflow needs a journal. */
	rollbackOverflow(): boolean {
		const undo = this.overflowUndo
		if (!undo) return false
		for (let i = undo.length - 1; i >= 0; i--) this.cpu.restoreByte(undo.addresses[i], undo.values[i])
		const cpu = this.cpu
		cpu.pc = undo.pc; cpu.instructionCount = undo.count; cpu.nativeHalted = undo.halted; cpu.waiting = undo.pending
		cpu.console = cpu.console.slice(0, undo.outputLength)
		if (cpu.config.wideRegisters) for (let i = 0; i < cpu.w.length; i++) cpu.w[i] = BigInt(undo.registers[i * 2]) | BigInt(undo.registers[i * 2 + 1]) << 32n
		else cpu.r.set(undo.registers)
		cpu.callStack.length = 0
		for (const frame of undo.frames) cpu.callStack.push(frame)
		this.timeline.reset()
		this.overflowUndo = null
		return true
	}
	committed() { this.overflowUndo = null }
}

export class ConfiguredRuntime implements Machine, CpuContext {
	readonly r: Uint32Array
	readonly w: BigUint64Array
	readonly memory: Uint8Array
	readonly state: Uint32Array
	readonly history: CpuHistory
	readonly historyFormat
	readonly callStack: CallFrame[] = []
	readonly observers: ExecutionObserver[] = []
	readonly breakpoints = new Set<number>()
	pc = 0
	instructionAddress = 0
	instructionCount = 0
	console = ''
	paused = false
	onProgress: (() => void) | null = null
	nativeHalted = false
	waiting = false
	private inputValue: number | null = null
	private inputBits = 32
	private disposed = false
	private speed: number | null
	private paced: ReadonlySet<number> | null = null
	private readonly decoded = new Map<number, DecodedInstruction>()
	private readonly decodeCatalog = new Map<string, { instruction: CpuInstruction, id: number }>()
	private readonly instructions = new Map<number, CpuInstruction>()
	private nextDecodeId = 1
	private pruneDecodeAt = 65536
	private readonly pageVersions: Float64Array
	private readonly text = new HistoryText()
	private aliases: Map<number, { register: number, shift: number }> | null = null
	private readonly registerExchange: Uint32Array | null
	private readonly execution = new ExecutionController(this, {
		speed: () => this.speed, pacedAddresses: () => this.paced, depth: () => this.callStack.length,
		ready: () => !this.waiting || this.history.timeline.ahead,
	})
	private readonly commands = this.execution.historyCommands({
		history: () => this.history, cursor: () => this.historyCursor,
		undo: () => !this.disposed && this.moveHistory(false),
		after: () => notifyHistorySeek(this.observers, this.instructionCount),
	})
	private readonly edits = new MemoryEdits({
		region: address => this.disposed ? null : this.config.memoryRegion ? this.config.memoryRegion(address) : { start: 0, end: this.memory.length - 1 },
		read: address => this.peek(address),
		commit: (address, bytes) => this.edit(() => { for (let i = 0; i < bytes.length; i++) this.put(address + i, bytes[i]) }),
	})
	constructor(readonly config: CpuConfiguration, readonly program: ConfiguredProgram, options: MachineOptions) {
		if (config.memoryBytes > INTERNAL_STATE) throw new RangeError('Configured RAM exceeds journal address space')
		if (!Number.isInteger(config.stateWords ?? 0) || (config.stateWords ?? 0) < 0 || (config.stateWords ?? 0) > INTERNAL_STATE / 4) throw new RangeError('Internal state exceeds journal address space')
		this.state = new Uint32Array(config.stateWords ?? 0)
		this.r = new Uint32Array(config.wideRegisters ? 0 : config.registers.length)
		this.w = new BigUint64Array(config.wideRegisters ? config.registers.length : 0)
		this.registerExchange = config.readRegister && !config.wideRegisters ? new Uint32Array(this.r.length) : null
		this.memory = new Uint8Array(config.memoryBytes)
		this.pageVersions = new Float64Array(Math.ceil(config.memoryBytes / 256))
		if (config.memoryAliases?.length) {
			this.aliases = new Map()
			for (const alias of config.memoryAliases) for (let i = 0; i < alias.bytes; i++) this.aliases.set(alias.address + i, { register: alias.register, shift: 8 * ((alias.littleEndian ?? config.littleEndian) ? i : alias.bytes - i - 1) })
		}
		this.history = new CpuHistory(this, options.historyLimit)
		this.speed = options.speed
		const image = program.image()
		for (const section of image.sections) { this.range(section.address, section.bytes.length); this.memory.set(section.bytes, section.address) }
		this.pc = image.entryAddress ?? config.textBase
		config.reset?.(this)
		this.historyFormat = {
			instruction: (entry: HistoryRecord) => entry.kind === 'edit' ? '' : this.instructions.get((entry as CpuRecord).decodeId)?.text ?? '',
			effects: (entry: HistoryRecord, applied: boolean) => this.effects(entry, applied),
		}
	}
	get halted() { return this.nativeHalted || this.execution.stopped }
	get stopReason() { return this.execution.reason(this.nativeHalted) }
	get pendingInput() { return this.waiting && !this.halted ? INTEGER_INPUT : null }
	get historyCursor() { return this.history.timeline.index }
	get isDisposed() { return this.disposed }
	writeState(index: number, value: number) {
		if (!Number.isInteger(index) || index < 0 || index >= this.state.length) throw new RangeError('Internal state index exceeds schema')
		const old = this.state[index]
		value >>>= 0
		if (old === value) return
		for (let byte = 0; byte < 4; byte++) {
			const previous = old >>> (byte * 8) & 255
			if (previous !== (value >>> (byte * 8) & 255)) this.history.byte(INTERNAL_STATE + index * 4 + byte, previous)
		}
		this.state[index] = value
	}
	instructionByte(address: number, offset: number) { return this.memory[this.config.fetchAddress?.(this, address, offset) ?? address + offset] }
	segmentAddress = segmentAddress
	readSegment(segment: number, offset: number, bytes = 1, shift = 4, addressBits = 20, offsetBits = 16, littleEndian = true): number {
		if (!Number.isInteger(bytes) || bytes < 1 || bytes > 4) throw new RangeError('Segmented reads support one to four bytes')
		const first = segmentAddress(segment, offset, shift, addressBits, offsetBits)
		const next = segmentAddress(segment, offset + bytes - 1, shift, addressBits, offsetBits)
		if (next === first + bytes - 1) return this.read(first, bytes, littleEndian)
		let value = 0
		for (let i = 0; i < bytes; i++) value = value * 256 + this.read(segmentAddress(segment, offset + (littleEndian ? bytes - i - 1 : i), shift, addressBits, offsetBits))
		return value >>> 0
	}
	writeSegment(segment: number, offset: number, value: number, bytes = 1, shift = 4, addressBits = 20, offsetBits = 16, littleEndian = true) {
		if (!Number.isInteger(bytes) || bytes < 1 || bytes > 4) throw new RangeError('Segmented writes support one to four bytes')
		const first = segmentAddress(segment, offset, shift, addressBits, offsetBits)
		const last = segmentAddress(segment, offset + bytes - 1, shift, addressBits, offsetBits)
		if (last === first + bytes - 1) { this.write(first, value, bytes, littleEndian); return }
		for (let i = 0; i < bytes; i++) this.range(segmentAddress(segment, offset + i, shift, addressBits, offsetBits), 1)
		for (let i = 0; i < bytes; i++) this.write(segmentAddress(segment, offset + i, shift, addressBits, offsetBits), value >>> (8 * (littleEndian ? i : bytes - i - 1)))
	}
	private range(address: number, bytes: number) {
		if (!Number.isSafeInteger(address) || !Number.isSafeInteger(bytes) || address < 0 || bytes < 0 || address + bytes > this.memory.length) throw new RangeError(`Memory access outside RAM at 0x${address.toString(16)}`)
		if (bytes && this.config.memoryRegion) {
			const region = this.config.memoryRegion(address)
			if (!region || address + bytes - 1 > region.end) throw new RangeError(`Memory access outside mapped region at 0x${address.toString(16)}`)
		}
	}
	private peek(address: number): number {
		const alias = this.aliases?.get(address)
		return alias ? this.r[alias.register] >>> alias.shift & 255 : this.memory[address]
	}
	read(address: number, bytes = 1, littleEndian = this.config.littleEndian): number {
		this.range(address, bytes)
		if (bytes < 1 || bytes > 4) throw new RangeError('Use readWide for 64-bit memory')
		let value = 0
		for (let i = 0; i < bytes; i++) value = value * 256 + this.peek(address + (littleEndian ? bytes - i - 1 : i))
		if (this.observers.length) for (const observer of this.observers) observer.onMemoryRead?.(address, bytes)
		return value >>> 0
	}
	private put(address: number, value: number) {
		this.history.byte(address, this.peek(address))
		this.memory[address] = value & 255
		const alias = this.aliases?.get(address)
		if (alias) this.r[alias.register] = (this.r[alias.register] & ~(255 << alias.shift)) | ((value & 255) << alias.shift)
		this.pageVersions[Math.floor(address / 256)]++
	}
	restoreByte(address: number, value: number) {
		if (address >= INTERNAL_STATE) {
			const offset = address - INTERNAL_STATE, word = offset >>> 2, shift = (offset & 3) * 8
			this.state[word] = this.state[word] & ~(255 << shift) | value << shift
			return
		}
		this.memory[address] = value
		this.pageVersions[Math.floor(address / 256)]++
	}
	write(address: number, value: number, bytes = 1, littleEndian = this.config.littleEndian) {
		this.range(address, bytes)
		if (bytes < 1 || bytes > 4) throw new RangeError('Use writeWide for 64-bit memory')
		for (let i = 0; i < bytes; i++) this.put(address + (littleEndian ? i : bytes - i - 1), value >>> (i * 8))
		if (this.observers.length) for (const observer of this.observers) observer.onMemoryWrite?.(address, bytes, value)
	}
	readWide(address: number, littleEndian = this.config.littleEndian): bigint {
		this.range(address, 8)
		let result = 0n
		for (let i = 0; i < 8; i++) result = result * 256n + BigInt(this.peek(address + (littleEndian ? 7 - i : i)))
		if (this.observers.length) for (const observer of this.observers) observer.onMemoryRead?.(address, 8)
		return result
	}
	writeWide(address: number, value: bigint, littleEndian = this.config.littleEndian) {
		this.range(address, 8)
		for (let i = 0; i < 8; i++) this.put(address + (littleEndian ? i : 7 - i), Number(value >> BigInt(i * 8) & 255n))
		if (this.observers.length) for (const observer of this.observers) observer.onMemoryWrite?.(address, 8, Number(value & 0xffffffffn))
	}
	call(target: number, returnAddress = this.pc) {
		this.history.frame(true)
		this.callStack.push({ callAddress: this.instructionAddress, returnAddress, targetAddress: target })
		this.pc = target
	}
	ret(target: number) {
		if (this.callStack[this.callStack.length - 1]?.returnAddress === target) this.history.frame(false, this.callStack.pop())
		this.pc = target
	}
	branch(target: number, taken: boolean) {
		if (this.observers.length) for (const observer of this.observers) observer.onBranch?.(this.instructionAddress, taken, target)
		if (taken) this.pc = target
	}
	halt() { this.nativeHalted = true }
	output(text: string) { this.console += text }
	inputInteger(bits = 32): number {
		if (this.inputValue !== null) { const value = this.inputValue; this.inputValue = null; this.waiting = false; return value }
		this.inputBits = bits
		throw INPUT_WAIT
	}
	provideInput(input: string, cancelled = false) {
		if (this.disposed || this.halted || !this.waiting || cancelled) return false
		const value = parseIntegerInput(input, this.inputBits)
		if (value === null) return false
		this.history.timeline.branch()
		this.inputValue = value
		try { this.step() } finally { this.inputValue = null }
		return true
	}
	private instruction() {
		this.range(this.pc, this.config.instructionAlignment)
		if (this.pc % this.config.instructionAlignment) throw new Error(`Misaligned instruction address 0x${this.pc.toString(16)}`)
		const key = this.pc + (this.config.decodeKey?.(this, this.pc) ?? 0) * this.memory.length
		let decoded = this.decoded.get(key)
		if (decoded) {
			let stale = false
			for (let i = 0; i < decoded.pages.length; i++) if (this.pageVersions[decoded.pages[i]] !== decoded.versions[i]) { stale = true; break }
			if (stale) {
				let changed = false
				for (let i = 0; i < decoded.addresses.length; i++) if (this.memory[decoded.addresses[i]] !== decoded.bytes[i]) { changed = true; break }
				if (changed) decoded = undefined
				else for (let i = 0; i < decoded.pages.length; i++) decoded.versions[i] = this.pageVersions[decoded.pages[i]]
			}
		}
		if (!decoded) {
			const instruction = this.config.decode(this.memory, this.pc, this)
			const maximum = this.config.historySchema.entry.find(column => column.name === 'bytes')!.elements
			if (!Number.isInteger(instruction.size) || instruction.size < 1 || instruction.size > maximum) throw new Error('Invalid native instruction size')
			const addresses: number[] = [], pages: number[] = []
			const bytes = new Uint8Array(instruction.size)
			for (let i = 0; i < instruction.size; i++) {
				const address = this.config.fetchAddress?.(this, this.pc, i) ?? this.pc + i
				this.range(address, 1)
				addresses.push(address)
				bytes[i] = this.memory[address]
				const page = Math.floor(address / 256)
				if (!pages.includes(page)) pages.push(page)
			}
			const signature = `${key}:${bytes.join(',')}`
			let native = this.decodeCatalog.get(signature)
			if (!native) {
				native = { instruction, id: this.nextDecodeId++ }
				this.decodeCatalog.set(signature, native)
				this.instructions.set(native.id, instruction)
			}
			decoded = { ...native, addresses, bytes, pages, versions: pages.map(page => this.pageVersions[page]) }
			this.decoded.set(key, decoded)
			if (this.nextDecodeId >= this.pruneDecodeAt) this.pruneDecodes()
		}
		return decoded
	}
	/** Rare self-modifying code cleanup; ordinary instruction recording does no scan. */
	private pruneDecodes() {
		const retained = new Set<number>()
		for (const decoded of this.decoded.values()) retained.add(decoded.id)
		const log = this.history.log
		for (let index = 0; index < log.length; index++) retained.add(historyCount(log, index, 'decodeId'))
		for (const [signature, native] of this.decodeCatalog) if (!retained.has(native.id)) { this.decodeCatalog.delete(signature); this.instructions.delete(native.id) }
		this.pruneDecodeAt = this.nextDecodeId + 65536
	}
	step() {
		if (this.disposed) return
		if (this.moveHistory(true)) return
		if (this.halted || (this.waiting && this.inputValue === null)) return
		let captured = false
		const address = this.pc
		try {
			const { instruction, id } = this.instruction()
			this.history.begin(id, false, instruction.size)
			captured = true
			this.instructionAddress = address
			if (this.observers.length) for (const observer of this.observers) observer.onInstruction?.(address, instruction, this.instructionCount)
			if (this.config.advance) this.config.advance(this, instruction.size)
			else this.pc += instruction.size
			instruction.execute(this)
			this.config.afterInstruction?.(this)
			this.instructionCount++
			this.history.log.close()
			this.history.committed()
		} catch (error) {
			if (captured) {
				this.history.log.close()
				if (!this.history.rollbackOverflow()) { this.moveHistory(false); this.history.timeline.branch() }
			}
			if (error === INPUT_WAIT) { this.waiting = true; return }
			this.execution.recordFault(error, address)
			throw error
		}
	}
	private moveHistory(forward: boolean) {
		const timeline = this.history.timeline
		if (forward && !timeline.ahead) return false
		if (!timeline.ahead) this.text.text = this.console
		const moved = forward ? timeline.forward(this.exchange) : timeline.back(this.exchange)
		if (moved && forward) notifyHistorySeek(this.observers, this.instructionCount)
		return moved
	}
	private readonly exchange = (index: number, forward: boolean) => {
		const log = this.history.log, position = log.first + index, slot = position % log.entries.capacity
		const c = log.entries.block(position).buffers.columns
		// Virtual registers must be observed before their backing RAM or bank changes.
		if (this.registerExchange) for (let i = 0; i < this.r.length; i++) this.registerExchange[i] = Number(this.config.readRegister!(this, i))
		exchangeHistoryBytes(log, index, forward, (address, value) => {
			if (address >= INTERNAL_STATE) {
				const offset = address - INTERNAL_STATE, old = this.state[offset >>> 2] >>> ((offset & 3) * 8) & 255
				this.restoreByte(address, value)
				return old
			}
			const old = this.memory[address]
			this.memory[address] = value
			this.pageVersions[Math.floor(address / 256)]++
			return old
		})
		let held = this.pc; this.pc = c.controlPc[slot]; c.controlPc[slot] = held
		held = +this.nativeHalted; this.nativeHalted = !!c.halted[slot]; c.halted[slot] = held
		held = +this.waiting; this.waiting = !!c.pending[slot]; c.pending[slot] = held
		held = this.console.length; this.console = this.text.exchange(this.console, c.outputLength[slot]); c.outputLength[slot] = held
		const registers = c.registers
		if (this.config.wideRegisters) {
			for (let i = 0; i < this.w.length; i++) {
				const offset = slot * this.w.length * 2 + i * 2, value = this.w[i]
				this.w[i] = BigInt(registers[offset]) | BigInt(registers[offset + 1]) << 32n
				registers[offset] = Number(value & 0xffffffffn); registers[offset + 1] = Number(value >> 32n)
			}
		} else {
			for (let i = 0; i < this.r.length; i++) { const value = this.registerExchange?.[i] ?? this.r[i]; this.r[i] = registers[slot * this.r.length + i]; registers[slot * this.r.length + i] = value }
		}
		exchangeHistoryFrame(log, index, this.callStack)
		this.instructionCount = c.count[slot] + (forward && !c.kind[slot] ? 1 : 0)
	}
	private edit(change: () => void) {
		if (this.disposed) return false
		const changed = capturedHistoryEdit(() => { change(); this.config.afterEdit?.(this) }, {
			begin: () => this.history.begin(0, true), close: () => this.history.log.close(),
			undo: () => this.history.rollbackOverflow() || this.moveHistory(false), branch: () => this.history.timeline.branch(),
		})
		this.history.committed()
		return changed
	}
	setProgramCounter(address: number) {
		if (!this.execution.canEdit(address)) return
		if (address < 0 || address >= 2 ** this.config.pcBits) throw new RangeError('Program counter exceeds native address width')
		this.range(address, this.config.instructionAlignment)
		if (address % this.config.instructionAlignment) throw new Error('Misaligned program counter')
		this.edit(() => {
			if (this.config.setProgramCounter) this.config.setProgramCounter(this, address)
			else this.pc = address
			this.nativeHalted = false; this.waiting = false
		})
		this.execution.stopped = false
	}
	registerValues(): Registers {
		const values: Registers = { PC: this.pc }
		if (this.config.registerView) {
			this.config.registerView.registers.forEach((register, index) => { values[register.id] = this.config.registerView!.read(this.r, index) })
			return values
		}
		this.config.registers.forEach((register, index) => { values[register.id] = this.config.readRegister?.(this, index) ?? (this.config.wideRegisters ? this.w[index] : this.r[index]) })
		return values
	}
	writeRegister(id: string, value: RegisterValue) {
		if (!this.execution.canEdit(value)) return false
		if (id === 'PC') { try { this.setProgramCounter(Number(value)); return true } catch { return false } }
		if (this.config.registerView) {
			const view = this.config.registerView, index = view.registers.findIndex(register => register.id === id)
			if (index < 0 || !view.registers[index].editable) return false
			return this.edit(() => view.write(this, index, BigInt.asUintN(view.registers[index].bits, BigInt(value))))
		}
		const index = this.config.registers.findIndex(register => register.id === id)
		if (index < 0 || !this.config.registers[index].editable) return false
		return this.edit(() => {
			const masked = BigInt.asUintN(this.config.registers[index].bits, BigInt(value))
			if (this.config.writeRegister) this.config.writeRegister(this, index, this.config.wideRegisters ? masked : Number(masked))
			else if (this.config.wideRegisters) this.w[index] = masked
			else this.r[index] = Number(masked)
		})
	}
	inspectMemory(): MemoryInspector {
		const ram = new RamInspector(this.memory, { wordBytes: this.config.wordBytes as 1 | 2 | 4, littleEndian: this.config.littleEndian })
		if (!this.aliases && !this.config.memoryRegion) return ram
		const byte = (address: number) => !Number.isSafeInteger(address) || address < 0 || address >= this.memory.length || (this.config.memoryRegion && !this.config.memoryRegion(address)) ? undefined : this.peek(address)
		return { wordBytes: ram.wordBytes, littleEndian: ram.littleEndian, byte, word: address => {
			if (!Number.isSafeInteger(address) || address < 0) return undefined
			const aligned = address - address % ram.wordBytes
			let value = 0
			for (let i = 0; i < ram.wordBytes; i++) { const part = byte(aligned + (ram.littleEndian ? ram.wordBytes - i - 1 : i)); if (part === undefined) return undefined; value = value * 256 + part }
			return value >>> 0
		} }
	}
	writeByte(address: number, value: number) {
		if (!this.execution.canEdit(value) || !Number.isSafeInteger(address) || address < 0 || address >= this.memory.length) return false
		if (this.config.memoryRegion && !this.config.memoryRegion(address)) return false
		return this.edit(() => this.put(address, value))
	}
	insertByte(address: number, limit: number, value: number) { return this.execution.canEdit(value) && this.edits.insert(address, limit, value) }
	deleteByte(address: number, limit: number) { return this.execution.canEdit(address) && this.edits.delete(address, limit) }
	run() { return this.execution.runUntil(() => false) }
	continue() { return this.run() }
	runTo(address: number) { return this.execution.runTo(address) }
	async stepOver() {
		if (this.disposed || this.halted) return
		const { instruction } = this.execution.inspectInstruction(() => this.instruction())
		if (instruction.call) await this.execution.stepOver(this.config.fallThrough?.(this, instruction.size) ?? this.pc + instruction.size)
		else this.step()
	}
	stepToReturn() { return this.execution.stepToReturn() }
	pause() { this.execution.pause() }
	stop() { this.execution.stop() }
	stepBack() { return this.commands.stepBack() }
	rewindTo(id: number) { return this.commands.rewindTo(id) }
	configure(options: { speed?: number | null, pacedAddresses?: ReadonlySet<number> | null }) {
		if (options.speed !== undefined) this.speed = options.speed
		if (options.pacedAddresses !== undefined) this.paced = options.pacedAddresses
	}
	addBreakpoint(address: number) { if (Number.isSafeInteger(address) && address >= 0 && address < this.memory.length) this.breakpoints.add(address) }
	removeBreakpoint(address: number) { this.breakpoints.delete(address) }
	getBreakpoints() { return [...this.breakpoints] }
	dispose() { this.stop(); this.disposed = true; this.execution.dispose(() => { this.observers.length = 0; this.decoded.clear(); this.decodeCatalog.clear(); this.instructions.clear() }) }
	private effects(entry: HistoryRecord, applied: boolean): DescribedEffect[] {
		const effects = snapshotEffects(this.history.log, this.historyCursor, entry.id, applied, this.config.pcBits, values => {
			if (!this.config.wideRegisters && !this.config.registerView) values.registers('registers', this.r.length, 0, this.r.length, i => Number(this.config.readRegister?.(this, i) ?? this.r[i]), (i, value) => ({ subject: this.config.registers[i].name, register: this.config.registers[i].id, value }))
			if (this.config.registerView) {
				const view = this.config.registerView, before = new Uint32Array(this.r.length), after = new Uint32Array(this.r.length)
				for (let i = 0; i < this.r.length; i++) { before[i] = values.before('registers', i, this.r.length); after[i] = values.after('registers', this.r[i], i, this.r.length) }
				view.registers.forEach((register, index) => {
					const value = view.read(before, index)
					if (value !== view.read(after, index)) values.effects.push(describeValueEffect(applied, { subject: register.name, register: register.id, value }, register.bits))
				})
			}
			values.memory('address', 'value', undefined, address => address < INTERNAL_STATE)
			values.text('outputLength', this.console.length, this.history.timeline.ahead ? this.text.text : this.console)
			values.halted(this.nativeHalted)
		})
		if (this.config.wideRegisters) {
			const index = this.history.indexOfId(entry.id)
			if (index < 0) return effects
			const pos = this.history.log.first + index, slot = pos % this.history.log.entries.capacity
			const registers = this.history.log.entries.block(pos).buffers.columns.registers
			const next = historyNeighbour(this.history.log, this.historyCursor, index)
			for (let i = 0; i < this.w.length; i++) {
				const offset = slot * this.w.length * 2 + i * 2
				const value = BigInt(registers[offset]) | BigInt(registers[offset + 1]) << 32n
				const nextOffset = (next?.slot ?? 0) * this.w.length * 2 + i * 2
				const after = next ? BigInt(next.columns.registers[nextOffset]) | BigInt(next.columns.registers[nextOffset + 1]) << 32n : this.w[i]
				if (value !== after) effects.push(describeValueEffect(applied, { subject: this.config.registers[i].name, register: this.config.registers[i].id, value }, 64))
			}
		}
		return effects
	}
	toolConfig(): MachineConfig {
		const cached = new WeakMap<CpuInstruction, InstructionInfo>()
		const names = (this.config.registerView?.registers ?? this.config.registers).map(register => register.id)
		return {
			addressing: { instructionBytes: this.config.instructionAlignment, memoryWordBytes: this.config.wordBytes }, delayedBranching: this.config.delayedBranching ?? false,
			history: this.history,
			instructions: {
				encodings: ['native'], registerNames: names,
				decodeExecuted: entry => this.instructions.get((entry as CpuRecord).decodeId) ?? null,
				describe: opaque => {
					const instruction = opaque as CpuInstruction
					let info = cached.get(instruction)
					if (!info) {
						const kind = instruction.kind
						info = { mnemonic: instruction.text.split(/\s/)[0], encoding: 0,
							category: kind === 'branch' ? InstructionCategory.BRANCH : kind === 'call' || kind === 'jump' || kind === 'return' ? InstructionCategory.JUMP : kind === 'load' || kind === 'store' ? InstructionCategory.MEMORY : kind === 'system' ? InstructionCategory.TRAP : InstructionCategory.ALU,
							reads: (instruction.reads ?? []).map(id => names.indexOf(id)).filter(i => i >= 0), writes: (instruction.writes ?? []).map(id => names.indexOf(id)).filter(i => i >= 0),
							isLoad: kind === 'load', isBranch: kind === 'branch', isJump: kind === 'call' || kind === 'return' || kind === 'jump',
						}
						cached.set(instruction, info)
					}
					return info
				},
			},
		}
	}
}

/** Native modules supply declarative metadata and opcodes, never workbench copies. */
export function createConfiguredArchitecture(config: CpuConfiguration): ArchitectureDefinition {
	for (const name of config.instructions) if (!config.instructionHelp[name.toLowerCase()]) throw new Error(`Missing ${config.name} instruction documentation: ${name}`)
	let profile: MachineProfile | undefined
	const machineProfile = (): MachineProfile => {
		if (profile) return profile
		// One cold reset builds accurate metadata, including memory-backed registers;
		// no extra RAM image is allocated while publishing a live machine.
		const sources = { files: [{ name: 'reset.asm', code: '' }], entries: ['reset.asm'] }
		const program = new ConfiguredProgram(config, sources, { image: { sections: [], symbols: [], sourceMappings: [], entryAddress: config.textBase }, diagnostics: [] })
		const reset = new ConfiguredRuntime(config, program, { speed: null, historyLimit: 1 })
		const resetRegisters = reset.registerValues(), resetPc = reset.pc
		reset.dispose()
		profile = { bitmap: RGB32_LE, resetRegisters, resetPc, dataBase: config.dataBase, ...(config.characterSet ? { characterSet: config.characterSet } : {}),
			memorySections: config.memorySections ?? [{ id: 'text', label: 'Code', start: 0, end: config.dataBase - 1, code: true }, { id: 'data', label: 'Data', start: config.dataBase, end: config.memoryBytes - 1 }],
			isMappedAddress: value => Number.isSafeInteger(value) && value >= 0 && value < config.memoryBytes && (!config.memoryRegion || config.memoryRegion(value) !== null),
		}
		return profile
	}
	const registerIds = new Map<string, string>([['pc', 'PC']])
	const viewRegisters = config.registerView?.registers ?? config.registers
	const floatIds = new Set(viewRegisters.filter(register => register.format === RegisterFormat.FLOAT).map(register => register.id))
	const encodedIds = new Map(viewRegisters.filter(register => register.format === RegisterFormat.FLOAT && register.bits === 64 && register.floatEncoding).map(register => [register.id, FLOAT_ENCODINGS[register.floatEncoding!]]))
	const doubleIds = new Set(viewRegisters.filter(register => register.format === RegisterFormat.FLOAT && register.bits === 64).map(register => register.id))
	for (const register of viewRegisters) for (const name of [register.id, register.name, ...(register.aliases ?? [])]) registerIds.set(name.toLowerCase(), register.id)
	const instructionHelp = (token: string) => {
		const doc = config.instructionHelp[token.toLowerCase()]
		return doc ? formatInstructionHelp(token, { title: `${config.name} assembly.`, summary: doc.description, forms: [doc.syntax], details: doc.details, reference: config.reference, link: config.instructionLink?.(token) }) : null
	}
	const describeToken = (line: string, offset: number, state: DebugInspection) => inspectAssemblyToken(line, offset, state, {
		tokens: config.tokenPattern ?? /[%\w.$]+(?:\/[a-z]+|,a)?/gi, comments: config.comments ?? [';'],
		register: token => registerIds.get(token.toLowerCase()),
		registerText: (token, id, value) => encodedIds.has(id) ? `**${token}** = 0x${BigInt(value).toString(16).padStart(16, '0')} (${formatEncodedFloat(encodedIds.get(id)!, Number(BigInt(value) & 0xffffffffn), Number(BigInt(value) >> 32n))})` : doubleIds.has(id) ? `**${token}** = 0x${BigInt(value).toString(16).padStart(16, '0')} (${formatDouble(bitsToDouble(Number(BigInt(value) & 0xffffffffn), Number(BigInt(value) >> 32n)))})` : floatIds.has(id) ? `**${token}** = 0x${(Number(value) >>> 0).toString(16).padStart(8, '0')} (${formatSingle(bitsToSingle(Number(value)))})` : `**${token}** = ${value}`,
		labelText: (token, address) => `**${token}** = 0x${address.toString(16)}`,
		help: instructionHelp,
	})
	const disassemblyFor = (cpu: () => CpuContext | undefined) => {
		const decode = (memory: MemoryInspector, address: number, sourceBytes?: number): string | null => {
			if (!Number.isSafeInteger(address) || address < 0 || address % config.instructionAlignment || memory.byte(address) === undefined) return null
			try {
				const bytes = new Proxy(new Uint8Array(0), { get: (_target, key) => typeof key === 'string' && /^\d+$/.test(key) ? memory.byte(Number(key)) : key === 'length' ? config.memoryBytes : undefined })
				return config.decode(bytes, address, cpu(), sourceBytes).text
			} catch { return null }
		}
		return {
		row: (row: { instruction: boolean, bytes: readonly number[], address: number }) => {
			if (!row.instruction) return `.byte ${row.bytes.join(', ')}`
			const width = Math.min(config.wordBytes, row.bytes.length)
			return decode({ byte: address => {
				const offset = address - row.address
				if (offset < 0 || offset >= row.bytes.length) return undefined
				const group = offset - offset % width, size = Math.min(width, row.bytes.length - group)
				return row.bytes[group + (config.littleEndian ? size - 1 - offset % width : offset % width)]
			}, word: () => undefined, wordBytes: config.wordBytes, littleEndian: config.littleEndian }, row.address, row.bytes.length) ?? ''
		},
		at: (memory: MemoryInspector, address: number): string | null => decode(memory, address),
		}
	}
	return {
		id: config.id, name: config.name, language: config.language, displayRadix: config.displayRadix,
		registers: [...viewRegisters, { id: 'PC', name: 'PC', bits: config.pcBits, bank: 'cpu', editable: true, role: 'programCounter' }],
		registerBanks: [...new Set([...viewRegisters.map(register => register.bank), 'cpu'])].map(id => ({ id, label: id === 'cpu' ? 'CPU' : id[0].toUpperCase() + id.slice(1) })),
		examples: canonicalExamples(config.examples),
		settings: defineSettings({ defaults: {}, fields: [] }),
		createServices: () => {
			let current: ConfiguredRuntime | undefined
			const disassembly = disassemblyFor(() => current && !current.isDisposed ? current : undefined)
			return createArchitectureServices(({ program: inspectionProgram, onRelease }) => {
				onRelease(() => { current = undefined })
				return {
					assemble: sources => new ConfiguredProgram(config, sources),
					createMachine: (program: AssembledProgram, _settings, options) => {
						if (!(program instanceof ConfiguredProgram) || program.config !== config) throw new Error(`Not a ${config.name} program`)
						current = new ConfiguredRuntime(config, program, options)
						return current
					},
					profile: machineProfile,
					disassembly, describeToken: (line, offset, state) => describeToken(line, offset, { ...state, labels: inspectionProgram()?.labels ?? state.labels }),
					installEditor: async (monaco: typeof Monaco, host: EditorHost) => disposableGroup(scope => {
						scope.add(registerAssemblyLanguage(monaco, {
							id: config.language, extensions: ['.asm', '.s'], configuration: { comments: { lineComment: config.comments?.[0] ?? ';' }, wordPattern: /%?[A-Za-z_.$][\w.$]*/ },
							tokens: config.editor?.tokens ?? { ignoreCase: true, tokenizer: { root: [[new RegExp(`(?:${(config.comments ?? [';', '//']).map(escapeSymbol).join('|')}).*$`), 'comment'], [/"([^"\\]|\\.)*"/, 'string'], [/\b(?:0x[\da-f]+|\d+)\b/, 'number'], [/[\w.$]+:/, 'type.identifier'], [/%?[\w.$]+/, 'keyword']] } },
							completions: () => [...new Set([...config.instructions, ...viewRegisters.flatMap(register => [register.id, ...(register.aliases ?? [])]), ...(config.editor?.directives ?? ['.text', '.data', '.byte', '.word', '.long', '.asciz', '.org', '.include', '.equ', ...Object.keys(config.directiveWidths ?? {})])])].map(label => {
								const help = instructionHelp(label)
								return { label, insertText: label, kind: monaco.languages.CompletionItemKind.Keyword, ...(help ? { documentation: { value: help.contents.join('\n\n') } } : {}) }
							}),
						}))
						scope.add(registerTokenHover(monaco, config.language, (line, offset) => describeToken(line, offset, host.inspection())))
						scope.add(registerGotoDefinition(monaco, host, config.language, {
							nameAt: (line, column) => symbolAt(stripAssemblyComment(line, config.comments ?? [';', '//']), column),
							find: (files, name) => {
								const escaped = escapeSymbol(name)
								return findPatternDefinition(files, name, config.editor?.definitions(escaped) ?? [new RegExp(`^(\\s*)(${escaped})\\s*:`), new RegExp(`^(\\s*)(${escaped})(?:\\s*=|\\s+equ\\b)`, 'i'), new RegExp(`^(\\s*\\.(?:equ|set)\\s+)(${escaped})(?![\\w.$])`, 'i')], code => code.split(/\r?\n/).map(line => stripAssemblyComment(line, config.comments ?? [';', '//'])))
							},
						}))
					}),
				}
			})
		},
	}
}
