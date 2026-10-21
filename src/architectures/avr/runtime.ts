import { HistoryBufferLayout, type HistoryBufferSchema } from '../../core/historyBuffers'
import { HistoryLog } from '../../core/historyLog'
import type { ExecutionObserver, MachineConfig } from '../../core/observer'
import { yieldToHost } from '../../core/yieldToHost'
import type {
	CallFrame,
	HistoryFormatter,
	HistoryRecord,
	InstructionInfo,
	Machine,
	MachineOptions,
	MemoryInspector,
	Registers
} from '../contracts'
import { decode, format, type Instruction } from './isa'
import type { AvrProgram } from './program'

/** Explicit AVR storage: full small register file, sparse memory undo. */
export const avrHistorySchema: HistoryBufferSchema = {
	entry: [
		{ name: 'state', type: 'u16', elements: 35 },
		{ name: 'pc', type: 'u32', elements: 1 },
		{ name: 'count', type: 'f64', elements: 1 },
		{ name: 'word', type: 'u32', elements: 1 },
		{ name: 'kind', type: 'u8', elements: 1 }
	],
	effect: [
		{ name: 'address', type: 'u32', elements: 1 },
		{ name: 'old', type: 'u8', elements: 1 },
		{ name: 'new', type: 'u8', elements: 1 }
	],
	payloads: ['entry']
}
const layout = new HistoryBufferLayout(avrHistorySchema)
const STATE = layout.column('entry', 'state', 'u16', 35)
const PC = layout.column('entry', 'pc', 'u32')
const COUNT = layout.column('entry', 'count', 'f64')
const WORD = layout.column('entry', 'word', 'u32')
const KIND = layout.column('entry', 'kind', 'u8')
const ADDRESS = layout.column('effect', 'address', 'u32')
const OLD = layout.column('effect', 'old', 'u8')
const NEW = layout.column('effect', 'new', 'u8')
const C = 1,
	Z = 2,
	N = 4,
	V = 8,
	S = 16,
	H = 32

export class AvrRuntime implements Machine {
	readonly registers = new Uint8Array(32)
	readonly flash = new Uint8Array(65536)
	readonly data = new Uint8Array(65536)
	readonly observers: ExecutionObserver[] = []
	readonly breakpoints = new Set<number>()
	readonly log = new HistoryLog(layout)
	readonly callStack: CallFrame[] = []
	pc = 0
	sp = 65535
	sreg = 0
	halted = false
	paused = false
	instructionCount = 0
	readonly pendingInput = null
	readonly console = ''
	onProgress: (() => void) | null = null
	private speed: number | null
	private running = false
	private disposed = false
	private nextId = 0
	private readonly decoded = new Map<number, Instruction>()
	private paced: ReadonlySet<number> | null = null
	constructor(
		readonly program: AvrProgram,
		options: MachineOptions
	) {
		this.speed = options.speed
		this.log.limit = Math.max(1, options.historyLimit)
		for (const section of program.image().sections) {
			if (section.address < 65536 && section.address + section.bytes.length <= 65536)
				this.flash.set(section.bytes, section.address)
			else if (section.address >= 65536 && section.address + section.bytes.length <= 131072)
				this.data.set(section.bytes, section.address - 65536)
			else throw new Error('AVR section crosses the flash/data boundary')
		}
		this.pc = program.image().entryAddress ?? 0
	}
	get historyCursor() {
		return this.log.length
	}
	readonly history = {
		get length() {
			return this.owner.log.length
		},
		owner: this,
		at(index: number): HistoryRecord | undefined {
			const log = this.owner.log
			if (index < 0 || index >= log.length) return undefined
			const p = log.first + index,
				slot = p % log.entries.capacity,
				a = log.entries.block(p).arrays
			return {
				id: log.id(index),
				instructionCount: a[COUNT][slot],
				address: a[PC][slot],
				kind: a[KIND][slot] ? 'edit' : 'instruction'
			}
		},
		slice(from: number, to: number) {
			const rows: HistoryRecord[] = []
			for (let i = Math.max(0, from); i < Math.min(to, this.length); i++) rows.push(this.at(i)!)
			return rows
		},
		indexOfId(id: number) {
			return this.owner.log.indexOfId(id)
		},
		instructionCountAt(index: number) {
			return this.at(index)?.instructionCount ?? 0
		}
	}
	readonly historyFormat: HistoryFormatter = {
		instruction: (entry) => {
			const index = this.log.indexOfId(entry.id)
			if (index < 0) return ''
			if (entry.kind === 'edit') return 'Edit'
			const p = this.log.first + index,
				a = this.log.entries.block(p).arrays,
				word = a[WORD][p % this.log.entries.capacity]
			try {
				return format(decode(word & 65535, word >>> 16), entry.address)
			} catch {
				return ''
			}
		},
		effects: (entry, applied) => {
			const index = this.log.indexOfId(entry.id)
			if (index < 0) return []
			const p = this.log.first + index,
				slot = p % this.log.entries.capacity
			const before = this.log.entries.block(p).arrays[STATE]
			const next = index + 1 < this.log.length ? this.log.entries.block(p + 1).arrays[STATE] : null
			const nextSlot = ((p + 1) % this.log.entries.capacity) * 35
			const effects = []
			for (let register = 0; register < 35; register++) {
				const old = before[slot * 35 + register]
				const after = next
					? next[nextSlot + register]
					: register < 32
						? this.registers[register]
						: register === 32
							? this.sp
							: register === 33
								? this.sreg
								: Number(this.halted)
				if (old === after) continue
				const name =
					register < 32
						? `r${register}`
						: register === 32
							? 'SP'
							: register === 33
								? 'SREG'
								: 'Halted'
				const value = applied ? old : after
				effects.push({
					subject: name,
					register: register < 34 ? name : undefined,
					value,
					applied,
					label: `${name} = 0x${value.toString(16)}`
				})
			}
			const start = this.log.effectStart(index)
			for (let offset = 0; offset < this.log.effectCount(index); offset++) {
				const position = start + offset,
					a = this.log.effects.block(position).arrays,
					s = position % this.log.effects.capacity
				const address = a[ADDRESS][s],
					value = a[applied ? OLD : NEW][s]
				effects.push({
					subject: `[0x${address.toString(16)}]`,
					register: undefined,
					address,
					value,
					applied,
					label: `[0x${address.toString(16)}] = 0x${value.toString(16)}`
				})
			}
			return effects
		}
	}
	private word(address: number) {
		if (!Number.isInteger(address) || address < 0 || address > 65534 || address % 2)
			throw new Error(`Invalid AVR flash PC 0x${address.toString(16)}`)
		return this.flash[address] | (this.flash[address + 1] << 8)
	}
	private instruction() {
		const first = this.word(this.pc)
		const second = this.pc < 65534 ? this.word(this.pc + 2) : 0
		const key = (first | (second << 16)) >>> 0
		let instruction = this.decoded.get(key)
		if (!instruction) {
			instruction = decode(first, second)
			if (this.decoded.size >= 4096) this.decoded.clear()
			this.decoded.set(key, instruction)
		}
		return instruction
	}
	private begin(edit: boolean, word = 0) {
		const slot = this.log.openEntryWith(this.nextId++)
		const arrays = this.log.entries.tail!.arrays
		arrays[STATE].set(this.registers, slot * 35)
		arrays[STATE][slot * 35 + 32] = this.sp
		arrays[STATE][slot * 35 + 33] = this.sreg
		arrays[STATE][slot * 35 + 34] = Number(this.halted)
		arrays[PC][slot] = this.pc
		arrays[COUNT][slot] = this.instructionCount
		arrays[WORD][slot] = word
		arrays[KIND][slot] = Number(edit)
	}
	private saveFrames(returning = false) {
		// One inverse delta per call/return; retaining whole stacks costs O(depth²).
		this.log.entries.setPayload(this.log.openEntry, {
			depth: this.callStack.length,
			frame: returning ? this.callStack[this.callStack.length - 1] : undefined
		})
	}
	private read(address: number, observe = true): number {
		if (!Number.isInteger(address) || address < 0 || address > 65535)
			throw new Error('AVR data address outside 16-bit space')
		if (address >= 32 && address < 256 && ![0x5d, 0x5e, 0x5f].includes(address))
			throw new Error(`AVR peripheral/I/O address 0x${address.toString(16)} is not implemented`)
		if (observe) for (const observer of this.observers) observer.onMemoryRead?.(65536 + address, 1)
		return address < 32
			? this.registers[address]
			: address === 0x5d
				? this.sp & 255
				: address === 0x5e
					? this.sp >> 8
					: address === 0x5f
						? this.sreg
						: this.data[address]
	}
	private write(address: number, value: number) {
		this.read(address, false)
		value &= 255
		if (address < 32) this.registers[address] = value
		else if (address === 0x5d) this.sp = (this.sp & 0xff00) | value
		else if (address === 0x5e) this.sp = (this.sp & 255) | (value << 8)
		else if (address === 0x5f) this.sreg = value
		else {
			const slot = this.log.pushEffect()
			if (slot >= 0) {
				const a = this.log.effects.tail!.arrays
				a[ADDRESS][slot] = 65536 + address
				a[OLD][slot] = this.data[address]
				a[NEW][slot] = value
			}
			this.data[address] = value
		}
		for (const observer of this.observers) observer.onMemoryWrite?.(65536 + address, 1, value)
	}
	private push(value: number) {
		this.write(this.sp, value)
		this.sp = (this.sp - 1) & 65535
	}
	private pop() {
		this.sp = (this.sp + 1) & 65535
		return this.read(this.sp)
	}
	private nzv(value: number, overflow: boolean, carry?: boolean, half?: boolean, sticky = false) {
		const n = !!(value & 128),
			z = value === 0 && (!sticky || !!(this.sreg & Z))
		let mask = N | Z | V | S,
			flags = (n ? N : 0) | (z ? Z : 0) | (overflow ? V : 0) | (n !== overflow ? S : 0)
		if (carry !== undefined) {
			mask |= C
			if (carry) flags |= C
		}
		if (half !== undefined) {
			mask |= H
			if (half) flags |= H
		}
		this.sreg = (this.sreg & ~mask) | flags
	}
	step() {
		if (this.disposed || this.halted) return
		const i = this.instruction()
		const address = this.pc,
			word = this.word(address) | ((i.size === 4 ? this.word(address + 2) : 0) << 16)
		this.begin(false, word >>> 0)
		try {
			for (const observer of this.observers)
				observer.onInstruction?.(address, i, this.instructionCount)
			this.pc += i.size
			this.execute(i, address)
			this.instructionCount++
			this.log.close()
		} catch (error) {
			this.log.close()
			this.undo()
			for (const observer of this.observers) observer.onSeek?.(this.instructionCount)
			throw error
		}
	}
	private execute(i: Instruction, address: number) {
		const d = i.d ?? 0,
			r = i.r ?? 0,
			k = i.k ?? 0,
			a = this.registers[d],
			b = i.r === undefined ? k : this.registers[r]
		let result: number
		switch (i.name) {
			case 'nop':
				return
			case 'break':
				this.halted = true
				return
			case 'ldi':
				this.registers[d] = k
				return
			case 'mov':
				this.registers[d] = b
				return
			case 'add':
			case 'adc':
			case 'sub':
			case 'sbc':
			case 'cp':
			case 'cpc':
			case 'subi':
			case 'sbci':
			case 'cpi': {
				const subtract = !['add', 'adc'].includes(i.name)
				const carry = ['adc', 'sbc', 'cpc', 'sbci'].includes(i.name) ? this.sreg & C : 0
				const raw = subtract ? a - b - carry : a + b + carry
				result = raw & 255
				const overflow = !!((subtract ? (a ^ b) & (a ^ result) : ~(a ^ b) & (a ^ result)) & 128)
				this.nzv(
					result,
					overflow,
					subtract ? raw < 0 : raw > 255,
					subtract ? (a & 15) - (b & 15) - carry < 0 : (a & 15) + (b & 15) + carry > 15,
					['sbc', 'cpc', 'sbci'].includes(i.name)
				)
				if (!['cp', 'cpc', 'cpi'].includes(i.name)) this.registers[d] = result
				return
			}
			case 'and':
			case 'andi':
			case 'or':
			case 'ori':
			case 'eor':
				result = i.name.startsWith('and') ? a & b : i.name.startsWith('or') ? a | b : a ^ b
				this.registers[d] = result
				this.nzv(result, false)
				return
			case 'com':
				result = a ^ 255
				this.registers[d] = result
				this.nzv(result, false, true)
				return
			case 'neg':
				result = -a & 255
				this.registers[d] = result
				this.nzv(result, result === 128, result !== 0, !!((result | a) & 8))
				return
			case 'inc':
			case 'dec':
				result = (a + (i.name === 'inc' ? 1 : -1)) & 255
				this.registers[d] = result
				this.nzv(result, result === (i.name === 'inc' ? 128 : 127))
				return
			case 'swap':
				this.registers[d] = (a << 4) | (a >> 4)
				return
			case 'lsr':
			case 'asr':
			case 'ror':
				result =
					(a >> 1) | (i.name === 'asr' ? a & 128 : i.name === 'ror' ? (this.sreg & C) << 7 : 0)
				this.registers[d] = result
				this.nzv(result, !!(result & 128) !== !!(a & 1), !!(a & 1))
				return
			case 'mul':
				result = a * b
				this.registers[0] = result & 255
				this.registers[1] = result >> 8
				this.sreg = (this.sreg & ~(Z | C)) | (result === 0 ? Z : 0) | (result & 0x8000 ? C : 0)
				return
			case 'bset':
				this.sreg |= 1 << k
				return
			case 'bclr':
				this.sreg &= ~(1 << k)
				return
			case 'bst':
				this.sreg = (this.sreg & ~64) | (((a >> k) & 1) << 6)
				return
			case 'bld':
				this.registers[d] = (a & ~(1 << k)) | (((this.sreg >> 6) & 1) << k)
				return
			case 'push':
				this.push(a)
				return
			case 'pop':
				this.registers[d] = this.pop()
				return
			case 'in':
				this.registers[d] = this.read(k + 32)
				return
			case 'out':
				this.write(k + 32, a)
				return
			case 'lds':
				this.registers[d] = this.read(k)
				return
			case 'sts':
				this.write(k, a)
				return
			case 'ld':
			case 'st': {
				const p = k >= 12 ? 26 : k >= 8 ? 28 : 30
				let pointer = this.registers[p] | (this.registers[p + 1] << 8)
				if ([2, 10, 14].includes(k)) pointer = (pointer - 1) & 65535
				if (i.name === 'ld') this.registers[d] = this.read(pointer)
				else this.write(pointer, a)
				if ([1, 9, 13].includes(k)) pointer = (pointer + 1) & 65535
				if (![0, 8, 12].includes(k)) {
					this.registers[p] = pointer & 255
					this.registers[p + 1] = pointer >> 8
				}
				return
			}
			case 'lpm':
				result = this.registers[30] | (this.registers[31] << 8)
				this.registers[0] = this.flash[result]
				for (const observer of this.observers) observer.onMemoryRead?.(result, 1)
				return
			case 'branch': {
				const taken = !!(this.sreg & (1 << d)) !== !!r
				const target = this.pc + k * 2
				if (taken) this.pc = target
				for (const observer of this.observers) observer.onBranch?.(address, taken, target)
				return
			}
			case 'cpse':
			case 'sbrc':
			case 'sbrs': {
				const skip = i.name === 'cpse' ? a === b : !!(a & (1 << k)) === (i.name === 'sbrs')
				const nextWord = this.word(this.pc)
				const long =
					(nextWord & 0xfe0e) === 0x940c ||
					(nextWord & 0xfe0e) === 0x940e ||
					(nextWord & 0xfc0f) === 0x9000
				const target = this.pc + (long ? 4 : 2)
				if (skip) this.pc = target
				for (const observer of this.observers) observer.onBranch?.(address, skip, target)
				return
			}
			case 'rjmp':
			case 'jmp':
			case 'ijmp':
			case 'rcall':
			case 'call':
			case 'icall': {
				const target = i.name.startsWith('r')
					? this.pc + k * 2
					: i.name.startsWith('i')
						? (this.registers[30] | (this.registers[31] << 8)) * 2
						: k
				if (i.name.includes('call')) {
					this.saveFrames()
					const ret = this.pc / 2
					this.push(ret & 255)
					this.push(ret >> 8)
					this.callStack.push({
						callAddress: address,
						returnAddress: this.pc,
						targetAddress: target
					})
				}
				this.pc = target
				return
			}
			case 'ret':
				this.saveFrames(true)
				this.pc = ((this.pop() << 8) | this.pop()) * 2
				this.callStack.pop()
				return
		}
		throw new Error(`Unsupported AVR execution ${i.name}`)
	}
	private undo(): boolean {
		const index = this.log.length - 1
		if (index < 0) return false
		const p = this.log.first + index,
			slot = p % this.log.entries.capacity,
			arrays = this.log.entries.block(p).arrays
		for (
			let effect = this.log.effectStart(index) + this.log.effectCount(index) - 1;
			effect >= this.log.effectStart(index);
			effect--
		) {
			const e = this.log.effects.block(effect).arrays,
				s = effect % this.log.effects.capacity,
				address = e[ADDRESS][s]
			if (address < 65536) this.flash[address] = e[OLD][s]
			else this.data[address - 65536] = e[OLD][s]
		}
		this.registers.set(arrays[STATE].subarray(slot * 35, slot * 35 + 32))
		this.sp = arrays[STATE][slot * 35 + 32]
		this.sreg = arrays[STATE][slot * 35 + 33]
		this.halted = !!arrays[STATE][slot * 35 + 34]
		this.pc = arrays[PC][slot]
		this.instructionCount = arrays[COUNT][slot]
		const frames = this.log.entries.payload(p) as { depth: number; frame?: CallFrame } | undefined
		if (frames) {
			if (frames.frame && this.callStack.length < frames.depth) this.callStack.push(frames.frame)
			this.callStack.length = frames.depth
		}
		this.log.truncate(index)
		return true
	}
	stepBack() {
		if (this.disposed) return false
		const result = this.undo()
		if (result) {
			this.pause()
			for (const observer of this.observers) observer.onSeek?.(this.instructionCount)
		}
		return result
	}
	rewindTo(id: number) {
		const index = this.log.indexOfId(id)
		if (index < 0) return false
		while (this.log.length > index) this.stepBack()
		return true
	}
	registerValues(): Registers {
		return {
			...Object.fromEntries(Array.from(this.registers, (value, i) => [`r${i}`, value])),
			PC: this.pc,
			SP: this.sp,
			SREG: this.sreg
		}
	}
	writeRegister(id: string, value: number | bigint) {
		if (this.disposed || typeof value !== 'number' || !Number.isInteger(value)) return false
		const match = /^r(\d+)$/.exec(id),
			index = match ? Number(match[1]) : -1
		if (
			(index < 0 && !['PC', 'SP', 'SREG'].includes(id)) ||
			index > 31 ||
			value < 0 ||
			value > (id === 'PC' || id === 'SP' ? 65535 : 255) ||
			(id === 'PC' && value % 2)
		)
			return false
		this.begin(true)
		if (index >= 0) this.registers[index] = value
		else if (id === 'PC') {
			this.pc = value
			this.halted = false
		} else if (id === 'SP') this.sp = value
		else this.sreg = value
		this.log.close()
		return true
	}
	inspectMemory(): MemoryInspector {
		return {
			wordBytes: 2,
			littleEndian: true,
			byte: (address) => {
				if (!Number.isInteger(address) || address < 0 || address >= 131072) return undefined
				if (address < 65536) return this.flash[address]
				const at = address - 65536
				if (at < 32) return this.registers[at]
				return at === 0x5d
					? this.sp & 255
					: at === 0x5e
						? this.sp >> 8
						: at === 0x5f
							? this.sreg
							: at < 256
								? undefined
								: this.data[at]
			},
			word(address) {
				const at = address & ~1,
					lo = this.byte(at),
					hi = this.byte(at + 1)
				return lo === undefined || hi === undefined ? undefined : lo | (hi << 8)
			}
		}
	}
	writeByte(address: number, value: number) {
		if (
			this.disposed ||
			!Number.isInteger(address) ||
			address < 0 ||
			address >= 131072 ||
			!Number.isFinite(value)
		)
			return false
		if (address >= 65568 && address < 65792 && ![65629, 65630, 65631].includes(address))
			return false
		this.begin(true)
		if (address < 65536) {
			const s = this.log.pushEffect(),
				a = this.log.effects.tail!.arrays
			if (s >= 0) {
				a[ADDRESS][s] = address
				a[OLD][s] = this.flash[address]
				a[NEW][s] = value & 255
			}
			this.flash[address] = value & 255
		} else this.write(address - 65536, value)
		this.log.close()
		return true
	}
	insertByte() {
		return false
	}
	deleteByte() {
		return false
	}
	provideInput() {
		return false
	}
	setProgramCounter(address: number) {
		this.writeRegister('PC', address)
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
		return this.breakpoints.values()
	}
	pause() {
		this.paused = true
		this.running = false
	}
	stop() {
		this.pause()
		this.halted = true
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
		const i = this.instruction()
		if (i.name.includes('call')) {
			const target = this.pc + i.size,
				depth = this.callStack.length
			await this.runUntil(() => this.pc === target && this.callStack.length <= depth)
		} else this.step()
	}
	stepToReturn() {
		const depth = this.callStack.length
		return this.runUntil(() => depth > 0 && this.callStack.length < depth)
	}
	private async runUntil(done: () => boolean) {
		if (this.running || this.disposed || this.halted) return
		this.running = true
		this.paused = false
		let first = true
		try {
			while (this.running && !this.halted && !this.disposed) {
				const start = performance.now(),
					batch =
						this.speed === null ? 20000 : Math.max(1, Math.round(Math.max(1, this.speed) / 30))
				let visible = 0
				for (let n = 0; n < 20000 && visible < batch && this.running && !this.halted; n++) {
					if (!first && this.breakpoints.has(this.pc)) {
						this.pause()
						break
					}
					const address = this.pc
					first = false
					this.step()
					if (done()) {
						this.pause()
						break
					}
					if (!this.paced || this.paced.has(address)) visible++
				}
				if (this.disposed) break
				this.onProgress?.()
				if (this.running && !this.halted) {
					if (this.speed === null) await yieldToHost()
					else {
						const speed = this.speed
						const deadline =
							performance.now() +
							Math.max(0, (visible * 1000) / Math.max(1, speed) - (performance.now() - start))
						await yieldToHost()
						while (
							this.running &&
							!this.disposed &&
							this.speed === speed &&
							performance.now() < deadline
						)
							await new Promise((resolve) =>
								setTimeout(resolve, Math.min(50, deadline - performance.now()))
							)
					}
				}
			}
		} finally {
			this.running = false
		}
	}
	toolConfig(): MachineConfig {
		return {
			delayedBranching: false,
			history: this.history,
			instructions: {
				encodings: ['AVR'],
				registerNames: Array.from({ length: 32 }, (_, i) => `r${i}`),
				describe: (opaque) => describe(opaque as Instruction),
				decodeExecuted: (entry) => {
					const index = this.log.indexOfId(entry.id)
					if (index < 0 || entry.kind === 'edit') return null
					const p = this.log.first + index,
						word = this.log.entries.block(p).arrays[WORD][p % this.log.entries.capacity]
					return decode(word & 65535, word >>> 16)
				}
			}
		}
	}
	dispose() {
		this.disposed = true
		this.running = false
		this.onProgress = null
		this.observers.length = 0
		this.log.clear()
	}
}
function describe(i: Instruction): InstructionInfo {
	const load = ['ld', 'lds', 'lpm', 'pop', 'in'].includes(i.name),
		memory = load || ['st', 'sts', 'push', 'out'].includes(i.name),
		branch = ['branch', 'cpse', 'sbrc', 'sbrs'].includes(i.name),
		jump = ['rjmp', 'rcall', 'jmp', 'call', 'ijmp', 'icall', 'ret'].includes(i.name)
	return {
		mnemonic: i.name,
		category: memory ? 3 : branch ? 2 : jump ? 1 : i.name === 'break' ? 5 : 0,
		encoding: 0,
		reads: [i.d, i.r].filter((r): r is number => r !== undefined),
		writes: [i.d === undefined ||
			branch ||
			['cp', 'cpc', 'cpi', 'sts', 'st', 'out', 'push', 'bst'].includes(i.name)
				? -1
				: i.d].filter(r => r >= 0),
		isLoad: load,
		isBranch: branch,
		isJump: jump
	}
}
