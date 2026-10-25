import { TeachingConsole, recordIntegerInput } from '../../core/environments/teachingConsole'
import { HistoryText } from '../../core/historyCursor'
import type { CallFrame } from '../contracts'
import type { ExecutionObserver } from '../../core/observer'
import { decodeInstruction, type Decoded, type Operand } from './decode'
import { M68kHistory, type SavedState } from './history'
import { C, condition, mask, MEMORY_BYTES, N, sign, V, X, Z } from './isa'
import type { CpuModel } from './settings'
import { executeFpu, resetFpu } from './fpu'
import { FP_WORDS, type Coprocessor } from './fpuIsa'

export interface Location {
	kind: 'data' | 'address' | 'memory' | 'immediate'
	index: number
}
/** CPU state is framework independent; the runtime supplies scheduling and debugger services. */
export class M68kCpu {
	readonly registers = new Int32Array(16)
	/** FP0-FP7 in 96-bit layout, FPCR, FPSR and FPIAR; used only with a coprocessor. */
	readonly fp = new Int32Array(FP_WORDS)
	readonly memory = new Uint8Array(MEMORY_BYTES)
	readonly view = new DataView(this.memory.buffer)
	readonly callStack: CallFrame[] = []
	readonly history: M68kHistory
	readonly observers: ExecutionObserver[] = []
	pc = 0x1000
	sr = 0x2000
	halted = false
	pending = false
	count = 0
	output = ''
	get fullOutput() { return this.history.timeline.ahead ? this.outputText.text : this.output }
	private readonly outputText = new HistoryText()
	private readonly snapshot: SavedState = {
		pc: 0,
		count: 0,
		sr: 0,
		registers: this.registers,
		fp: this.fp,
		halted: false,
		pending: false,
		outputLength: 0
	}
	constructor(
		readonly model: CpuModel,
		historyLimit: number,
		readonly coprocessor: Coprocessor = 'none'
	) {
		this.history = new M68kHistory(historyLimit, coprocessor !== 'none')
		if (coprocessor !== 'none') resetFpu(this.fp)
		this.registers[15] = MEMORY_BYTES - 16
	}
	range(address: number, size: number, instruction = false) {
		if (!Number.isInteger(address) || address < 0 || address + size > MEMORY_BYTES)
			throw new Error(`Bus fault outside RAM at $${(address >>> 0).toString(16)}`)
		if ((instruction || this.model !== '68020') && size > 1 && address % 2)
			throw new Error(`Address error at odd address $${address.toString(16)}`)
	}
	decode() {
		return decodeInstruction(
			(address) => {
				this.range(address, 2, true)
				return this.view.getUint16(address, false)
			},
			this.pc,
			this.model,
			this.coprocessor !== 'none'
		)
	}
	saved() {
		const s = this.snapshot
		s.pc = this.pc
		s.count = this.count
		s.sr = this.sr
		s.halted = this.halted
		s.pending = this.pending
		s.outputLength = this.output.length
		return s
	}
	restore = (state: SavedState) => {
		this.pc = state.pc
		this.count = state.count
		this.sr = state.sr
		this.registers.set(state.registers)
		this.halted = state.halted
		this.pending = state.pending
		this.output = this.outputText.exchange(this.output, state.outputLength)
		if (state.frameAction === 1) this.callStack.pop()
		else if (state.frameAction === 2 && state.frame) this.callStack.push(state.frame)
	}
	undo(forward = false) {
		if (forward && !this.history.timeline.ahead) return false
		if (!this.history.timeline.ahead) this.outputText.text = this.output
		const moved = this.history.undo(this.restore, (address, value) => {
			const old = this.memory[address]
			this.memory[address] = value
			return old
		}, this.saved(), this.callStack, forward)
		if (moved && forward) for (const observer of this.observers) observer.onSeek?.(this.count)
		return moved
	}
	putByte(address: number, value: number) {
		this.history.memory(address, this.memory[address])
		this.memory[address] = value & 255
	}
	readMemory(address: number, size: number): number {
		this.range(address, size)
		const value =
			size === 4
				? this.view.getUint32(address, false)
				: size === 2
					? this.view.getUint16(address, false)
					: this.memory[address]
		for (const observer of this.observers) observer.onMemoryRead?.(address, size)
		return value
	}
	writeMemory(address: number, value: number, size: number) {
		this.range(address, size)
		for (let i = 0; i < size; i++) this.putByte(address + i, value >>> ((size - i - 1) * 8))
		for (const observer of this.observers) observer.onMemoryWrite?.(address, size, value)
	}
	resolve(ea: Operand, size: number, control = false): Location {
		const { mode, reg, extension } = ea
		if (control && (![2, 5, 6, 7].includes(mode) || (mode === 7 && reg > 3)))
			throw new Error('Illegal control addressing mode')
		if (mode === 0) return { kind: 'data', index: reg }
		if (mode === 1) {
			if (size === 1) throw new Error('Byte address-register operand')
			return { kind: 'address', index: reg + 8 }
		}
		if (mode === 7 && reg === 4)
			return {
				kind: 'immediate',
				index: size === 4 ? (extension[0] * 65536 + extension[1]) >>> 0 : extension[0] & mask(size)
			}
		let address: number
		if (mode === 2 || mode === 3 || mode === 4) {
			const amount = size === 1 && reg === 7 ? 2 : size
			if (mode === 4) this.registers[reg + 8] -= amount
			address = this.registers[reg + 8] >>> 0
			if (mode === 3) this.registers[reg + 8] += amount
		} else if (mode === 5 || (mode === 7 && reg === 2))
			address = ((mode === 5 ? this.registers[reg + 8] : ea.extensionPc) + sign(extension[0], 2)) >>> 0
		else if (mode === 6 || (mode === 7 && reg === 3)) {
			const e = extension[0],
				index = e >>> 12,
				scaled = (e & 0x800 ? this.registers[index] : sign(this.registers[index], 2)) * (1 << ((e >> 9) & 3))
			address = ((mode === 6 ? this.registers[reg + 8] : ea.extensionPc) + sign(e, 1) + scaled) >>> 0
		} else if (mode === 7 && reg === 0) address = sign(extension[0], 2) >>> 0
		else if (mode === 7 && reg === 1) address = (extension[0] * 65536 + extension[1]) >>> 0
		else throw new Error('Illegal effective address')
		return { kind: 'memory', index: address }
	}
	read(location: Location, size: number) {
		return location.kind === 'memory'
			? this.readMemory(location.index, size)
			: location.kind === 'immediate'
				? location.index
				: (this.registers[location.index] & mask(size)) >>> 0
	}
	write(location: Location, size: number, value: number) {
		if (location.kind === 'immediate') throw new Error('Immediate is not writable')
		if (location.kind === 'memory') this.writeMemory(location.index, value, size)
		else if (location.kind === 'address') this.registers[location.index] = size === 2 ? sign(value, 2) : value
		else
			this.registers[location.index] =
				size === 4 ? value : (this.registers[location.index] & ~mask(size)) | (value & mask(size))
	}
	private logical(value: number, size: number) {
		const result = (value & mask(size)) >>> 0
		this.sr = (this.sr & ~(N | Z | V | C)) | (result === 0 ? Z : 0) | (sign(result, size) < 0 ? N : 0)
	}
	private arithmetic(a: number, b: number, subtract: boolean, size: number, compare = false): number {
		const limit = size === 4 ? 0x100000000 : 2 ** (size * 8),
			ua = (a & mask(size)) >>> 0,
			ub = (b & mask(size)) >>> 0
		const result = subtract ? ua - ub : ua + ub,
			value = (result & mask(size)) >>> 0
		const sa = sign(ua, size),
			sb = sign(ub, size),
			sr = sign(value, size)
		const carry = subtract ? ub > ua : result >= limit,
			overflow = subtract ? sa < 0 !== sb < 0 && sa < 0 !== sr < 0 : sa < 0 === sb < 0 && sa < 0 !== sr < 0
		this.sr =
			(this.sr & ~(N | Z | V | C | (compare ? 0 : X))) |
			(sr < 0 ? N : 0) |
			(value === 0 ? Z : 0) |
			(overflow ? V : 0) |
			(carry ? C | (compare ? 0 : X) : 0)
		return value
	}
	private push(value: number) {
		this.registers[15] -= 4
		this.writeMemory(this.registers[15] >>> 0, value, 4)
	}
	private pop() {
		const value = this.readMemory(this.registers[15] >>> 0, 4)
		this.registers[15] += 4
		return value
	}
	private call(target: number, returnAddress: number, callAddress: number) {
		this.range(target, 2, true)
		this.push(returnAddress)
		this.history.frame(true)
		this.callStack.push({ callAddress, returnAddress, targetAddress: target })
		this.pc = target
	}
	private returned(target: number) {
		this.range(target, 2, true)
		const top = this.callStack[this.callStack.length - 1]
		if (top?.returnAddress === target) this.history.frame(false, this.callStack.pop()!)
		this.pc = target
	}
	step(): void {
		if (this.undo(true)) return
		if (this.halted || this.pending) return
		const d = this.decode()
		if (d.name === 'trap' && d.value === 15 && this.registers[0] === 5) {
			this.pending = true
			return
		}
		this.history.begin(this.saved(), d)
		try {
			for (const observer of this.observers) observer.onInstruction?.(this.pc, d, this.count)
			this.execute(d)
			this.count++
			this.history.log.close()
		} catch (error) {
			this.history.log.close()
			this.undo()
			this.history.timeline.branch()
			for (const observer of this.observers) observer.onSeek?.(this.count)
			throw error
		}
	}
	private execute(d: Decoded) {
		const { name, size } = d,
			next = this.pc + d.length,
			oldPc = this.pc
		this.pc = next
		if (d.fpu) {
			executeFpu(this, d, oldPc)
			return
		}
		if (name === 'illegal') throw new Error('ILLEGAL instruction')
		if (name === 'nop') return
		if (name === 'bkpt') {
			this.halted = true
			return
		}
		if (name === 'trap') {
			if (d.value !== 15) throw new Error('Only educational TRAP #15 is supported')
			const service = this.registers[0]
			if (!this.teachingConsole.dispatch(service)) throw new Error(`Unsupported TRAP #15 service ${service}`)
			return
		}
		if (name === 'bra' || name === 'bsr' || (name.startsWith('b') && d.condition !== undefined)) {
			const target = (oldPc + 2 + d.value!) >>> 0,
				taken = d.condition! < 2 || condition(d.condition!, this.sr)
			if (taken) {
				if (name === 'bsr') this.call(target, next, oldPc)
				else {
					this.range(target, 2, true)
					this.pc = target
				}
			}
			if (d.condition! >= 2) for (const observer of this.observers) observer.onBranch?.(oldPc, taken, target)
			return
		}
		if (name === 'dbcc') {
			let taken = false
			if (!condition(d.condition!, this.sr)) {
				const value = (this.registers[d.reg!] - 1) & 65535
				this.registers[d.reg!] = (this.registers[d.reg!] & 0xffff0000) | value
				taken = value !== 65535
				if (taken) {
					const target = (oldPc + 2 + d.value!) >>> 0
					this.range(target, 2, true)
					this.pc = target
				}
			}
			for (const observer of this.observers) observer.onBranch?.(oldPc, taken, (oldPc + 2 + d.value!) >>> 0)
			return
		}
		if (name === 'rts' || name === 'rtd') {
			const target = this.pop()
			if (name === 'rtd') this.registers[15] += d.value!
			this.returned(target)
			return
		}
		if (name === 'link') {
			this.push(this.registers[d.reg!])
			this.registers[d.reg!] = this.registers[15]
			this.registers[15] += d.value!
			return
		}
		if (name === 'unlk') {
			this.registers[15] = this.registers[d.reg!]
			this.registers[d.reg!] = this.pop()
			return
		}
		if (name === 'jsr' || name === 'jmp' || name === 'lea' || name === 'pea') {
			const target = this.resolve(d.source!, 4, true).index
			if (name === 'jsr') this.call(target, next, oldPc)
			else if (name === 'jmp') {
				this.range(target, 2, true)
				this.pc = target
			} else if (name === 'lea') this.registers[d.reg!] = target
			else this.push(target)
			return
		}
		if (name === 'moveq') {
			this.registers[d.reg!] = d.value!
			this.logical(d.value!, 4)
			return
		}
		if (name === 'move' || name === 'movea') {
			const source = this.resolve(d.source!, size),
				value = this.read(source, size),
				destination = this.resolve(d.destination!, size)
			if (destination.kind === 'immediate') throw new Error('Illegal MOVE destination')
			this.write(destination, size, value)
			if (name === 'move') this.logical(value, size)
			return
		}
		if (name === 'moveccr') {
			this.sr = 0x2000 | (this.read(this.resolve(d.source!, 2), 2) & 31)
			return
		}
		if (name === 'movesr' || name === 'fromccr') {
			this.write(this.resolve(d.destination!, 2), 2, name === 'movesr' ? this.sr : this.sr & 31)
			return
		}
		if (name.endsWith('ccr')) {
			const value = d.value! & 31,
				old = this.sr & 31
			this.sr = 0x2000 | (name === 'oriccr' ? old | value : name === 'andiccr' ? old & value : old ^ value)
			return
		}
		if (name === 'scc') {
			this.write(this.resolve(d.destination!, 1), 1, condition(d.condition!, this.sr) ? 255 : 0)
			return
		}
		if (name === 'swap') {
			const value = this.registers[d.reg!]
			this.registers[d.reg!] = (value << 16) | (value >>> 16)
			this.logical(this.registers[d.reg!], 4)
			return
		}
		if (name === 'ext' || name === 'extb') {
			const value = sign(this.registers[d.reg!], name === 'extb' || size === 2 ? 1 : 2)
			this.write({ kind: 'data', index: d.reg! }, size, value)
			this.logical(value, size)
			return
		}
		if (name === 'exg') {
			const value = this.registers[d.reg!]
			this.registers[d.reg!] = this.registers[d.value!]
			this.registers[d.value!] = value
			return
		}
		if (name === 'movem') {
			this.movem(d)
			return
		}
		if (['mulu', 'muls', 'divu', 'divs'].includes(name)) {
			const source = this.read(this.resolve(d.source!, 2), 2),
				value = name.endsWith('s') ? sign(source, 2) : source
			if (name.startsWith('mul')) {
				const result = Math.imul(
					value,
					name.endsWith('s') ? sign(this.registers[d.reg!], 2) : this.registers[d.reg!] & 65535
				)
				this.registers[d.reg!] = result
				this.logical(result, 4)
			} else {
				if (value === 0) throw new Error('Divide by zero')
				const dividend = name.endsWith('s') ? this.registers[d.reg!] : this.registers[d.reg!] >>> 0,
					quotient = Math.trunc(dividend / value)
				if (quotient < (name.endsWith('s') ? -32768 : 0) || quotient > (name.endsWith('s') ? 32767 : 65535)) {
					this.sr = (this.sr & ~C) | V
					return
				}
				const remainder = dividend % value
				this.registers[d.reg!] = (remainder << 16) | (quotient & 65535)
				this.logical(quotient, 2)
			}
			return
		}
		if (['adda', 'suba', 'cmpa'].includes(name)) {
			const source = this.read(this.resolve(d.source!, size), size),
				value = size === 2 ? sign(source, 2) : source,
				old = this.registers[d.reg!]
			if (name === 'cmpa') this.arithmetic(old, value, true, 4, true)
			else this.registers[d.reg!] = name === 'adda' ? old + value : old - value
			return
		}
		if (/^(?:as|ls|ro|rox)[lr]$/.test(name)) {
			this.shift(d)
			return
		}
		if (['btst', 'bchg', 'bclr', 'bset'].includes(name)) {
			const destination = this.resolve(d.destination!, size),
				old = this.read(destination, size),
				bit = (d.value ?? this.registers[d.reg!]) & (size === 4 ? 31 : 7),
				bitMask = 1 << bit
			this.sr = (this.sr & ~Z) | (old & bitMask ? 0 : Z)
			if (name !== 'btst')
				this.write(
					destination,
					size,
					name === 'bchg' ? old ^ bitMask : name === 'bclr' ? old & ~bitMask : old | bitMask
				)
			return
		}
		const sourceValue = d.source
			? this.read(this.resolve(d.source, size), size)
			: d.value !== undefined
				? d.value
				: d.reg !== undefined
					? this.registers[d.reg]
					: 0
		const destination = d.destination ? this.resolve(d.destination, size) : { kind: 'data' as const, index: d.reg! }
		const old = name === 'clr' ? 0 : this.read(destination, size)
		let result: number
		if (name === 'addq' || name === 'subq') {
			if (destination.kind === 'address') {
				this.registers[destination.index] += name === 'addq' ? sourceValue : -sourceValue
				return
			}
			result = this.arithmetic(old, sourceValue, name === 'subq', size)
		} else if (['add', 'addi', 'sub', 'subi', 'cmp', 'cmpi'].includes(name))
			result = this.arithmetic(
				old,
				sourceValue,
				name.startsWith('sub') || name.startsWith('cmp'),
				size,
				name.startsWith('cmp')
			)
		else if (name === 'neg') result = this.arithmetic(0, old, true, size)
		else {
			result =
				name === 'clr'
					? 0
					: name === 'not'
						? ~old
						: name === 'and' || name === 'andi'
							? old & sourceValue
							: name === 'or' || name === 'ori'
								? old | sourceValue
								: name === 'eor' || name === 'eori'
									? old ^ sourceValue
									: old
			this.logical(result, size)
		}
		if (!name.startsWith('cmp') && name !== 'tst') this.write(destination, size, result)
	}
	private movem(d: Decoded) {
		const ea = d.source ?? d.destination!,
			loading = !!d.source,
			predecrement = ea.mode === 4,
			postincrement = ea.mode === 3
		if (
			loading
				? ![2, 3, 5, 6, 7].includes(ea.mode) || (ea.mode === 7 && ea.reg > 3)
				: ![2, 4, 5, 6, 7].includes(ea.mode) || (ea.mode === 7 && ea.reg > 1)
		)
			throw new Error('Invalid MOVEM mode')
		let address =
			predecrement || postincrement ? this.registers[ea.reg + 8] >>> 0 : this.resolve(ea, d.size, true).index
		const oldBase = address
		for (let i = 0; i < 16; i++)
			if (d.mask! & (1 << i)) {
				const reg = predecrement ? 15 - i : i
				if (predecrement) address = (address - d.size) >>> 0
				if (loading) {
					const value = this.readMemory(address, d.size)
					this.registers[reg] = d.size === 2 ? sign(value, 2) : value
				} else {
					const value =
						predecrement && reg === ea.reg + 8 && this.model === '68020' ? oldBase - d.size : this.registers[reg]
					this.writeMemory(address, value, d.size)
				}
				if (!predecrement) address += d.size
			}
		if (predecrement || postincrement) this.registers[ea.reg + 8] = address
	}
	private shift(d: Decoded) {
		const { name, size } = d,
			count = d.source ? this.registers[d.source.reg] & 63 : d.value!,
			bits = size * 8,
			left = name.endsWith('l'),
			rotateX = name.startsWith('rox'),
			rotate = name.startsWith('ro')
		let value = (this.registers[d.reg!] & mask(size)) >>> 0,
			carry = false,
			overflow = false,
			extend = !!(this.sr & X)
		for (let i = 0; i < count; i++) {
			const before = sign(value, size)
			carry = left ? before < 0 : !!(value & 1)
			if (left) value = (value << 1) & mask(size)
			else value = name === 'asr' ? (sign(value, size) >> 1) & mask(size) : value >>> 1
			if (rotate) {
				const insert = rotateX ? extend : carry
				if (insert) value = left ? value | 1 : value | (1 << (bits - 1))
			}
			if (name === 'asl' && before < 0 !== sign(value, size) < 0) overflow = true
			if (!rotate || rotateX) extend = carry
		}
		this.logical(value, size)
		if (count ? carry : rotateX && extend) this.sr |= C
		if (overflow) this.sr |= V
		if ((!rotate || rotateX) && count) this.sr = (this.sr & ~X) | (extend ? X : 0)
		this.write({ kind: 'data', index: d.reg! }, size, value)
	}
	provideInput(input: string) {
		if (!this.pending) return false
		let instruction: Decoded
		return recordIntegerInput(input, 32, {
			begin: () => {
				instruction = this.decode()
				this.history.begin(this.saved(), instruction)
			},
			accept: value => {
				for (const observer of this.observers) observer.onInstruction?.(this.pc, instruction, this.count)
				this.registers[1] = value
				this.pending = false
				this.pc += instruction.length
				this.count++
			},
			close: () => { this.history.log.close() },
		})
	}
	/** Keep this host adapter after the native state fields to preserve their layout. */
	private readonly teachingConsole = new TeachingConsole({ integer: 3, character: 6, string: 14, exit: [9] }, {
		argument: string => this.registers[string ? 9 : 1],
		write: text => { this.output += text },
		read: address => this.readMemory(address, 1),
		stringLimit: () => this.memory.length + 1,
		halt: () => { this.halted = true },
	})

}
