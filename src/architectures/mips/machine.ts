/**
 * The MIPS simulator behind the neutral machine contract.
 *
 * Control calls forward to the simulator; the run loop, its observers and its
 * history stay the simulator's own, so nothing here sits on the per-instruction
 * path.
 */

import { CP0_REGISTERS } from './core/coprocessor'
import type { MachineConfig } from '../../core/observer'
import type { MipsSimulator } from './core/simulator'
import type { HistoryFormatter, KeyboardDisplayDevice, Machine, MemoryInspector, Registers } from '../contracts'
import { historyFormatter } from './history/format'
import { mipsInstructionSet } from './instructions'
import { FLAG_ID } from './registers'

const CP0_INDEX = new Map(CP0_REGISTERS.map((register) => [register.name, register.index]))
const FP_ID = /^\$f(\d+)$/

/**
 * Reads of the simulator's word-keyed memory.  The map is the simulator's own,
 * not a copy: this wrapper is the identity a publish hands the panels.  It never
 * goes through `readByte`, so a device register is not consumed by looking.
 */
export class WordMemory implements MemoryInspector {
	readonly wordBytes = 4
	readonly littleEndian = true

	constructor(readonly words: ReadonlyMap<number, number>) {}

	byte(address: number): number | undefined {
		const word = this.words.get((address >>> 0) >>> 2)
		return word === undefined ? undefined : (word >>> ((address & 3) * 8)) & 0xff
	}

	word(address: number): number | undefined {
		return this.words.get((address >>> 0) >>> 2)
	}
}

export class MipsMachine implements Machine {
	readonly historyFormat: HistoryFormatter
	readonly keyboardDisplay: KeyboardDisplayDevice

	constructor(readonly simulator: MipsSimulator) {
		this.historyFormat = historyFormatter(simulator.effects)
		this.keyboardDisplay = {
			state: () => ({ ...simulator.keyboardDisplay }),
			queue: (input) => simulator.queueKeyboardInput(input),
		}
	}

	get pc() { return this.simulator.pc }
	get halted() { return this.simulator.halted }
	get paused() { return this.simulator.paused }
	get pendingInput() { return this.simulator.pendingInput }
	get instructionCount() { return this.simulator.instructionCount }
	get breakpoints(): ReadonlySet<number> { return this.simulator.breakpoints }
	get console() { return this.simulator.console }
	get callStack() { return this.simulator.getCallStack() }
	get program() { return this.simulator.program }
	get observers() { return this.simulator.observers }
	get history() { return this.simulator.executionHistory }
	get historyCursor() { return this.simulator.getHistoryCursor() }
	get onProgress() { return this.simulator.onProgress }
	set onProgress(callback: (() => void) | null) { this.simulator.onProgress = callback }

	run() { return this.simulator.run() }
	continue() { return this.simulator.continue() }
	step() { this.simulator.step() }
	stepBack() { return this.simulator.stepBack() }
	stepOver() { return this.simulator.stepOver() }
	stepToReturn() { return this.simulator.stepToReturn() }
	runTo(address: number) { return this.simulator.runTo(address) }
	pause() { this.simulator.pause() }
	stop() { this.simulator.stop() }
	setProgramCounter(address: number) { this.simulator.setProgramCounter(address) }
	configure(options: { speed?: number | null, pacedAddresses?: ReadonlySet<number> | null }) { this.simulator.configure(options) }
	addBreakpoint(address: number) { this.simulator.addBreakpoint(address) }
	removeBreakpoint(address: number) { this.simulator.removeBreakpoint(address) }
	getBreakpoints() { return this.simulator.getBreakpoints() }
	provideInput(input: string, cancelled?: boolean) { return this.simulator.provideInput(input, cancelled) }
	rewindTo(id: number) { return this.simulator.rewindTo(id) }

	registerValues(): Registers {
		const { registers, fpRegisters, fpConditionFlags, cp0Registers } = this.simulator
		const values: Registers = { ...registers }
		for (let index = 0; index < fpConditionFlags.length; index++) values[FLAG_ID(index)] = fpConditionFlags[index] ? 1 : 0
		for (let index = 0; index < fpRegisters.length; index++) values[`$f${index}`] = fpRegisters[index]
		for (const { index, name } of CP0_REGISTERS) values[name] = cp0Registers[index] ?? 0
		return values
	}

	writeRegister(id: string, value: number): boolean {
		const fp = FP_ID.exec(id)
		if (fp) return this.simulator.setFpRegister(Number(fp[1]), value)
		const cp0 = CP0_INDEX.get(id)
		if (cp0 !== undefined) return this.simulator.setCp0Register(cp0, value)
		return this.simulator.setRegister(id, value | 0)
	}

	inspectMemory(): MemoryInspector {
		return new WordMemory(this.simulator.memory)
	}

	writeByte(address: number, value: number) { return this.simulator.setMemoryByte(address, value) }
	insertByte(address: number, limit: number, value: number) { return this.simulator.insertMemoryByte(address, limit, value) }
	deleteByte(address: number, limit: number) { return this.simulator.deleteMemoryByte(address, limit) }

	toolConfig(): MachineConfig {
		const simulator = this.simulator
		return {
			delayedBranching: simulator.delayedBranching,
			instructions: mipsInstructionSet,
			device: simulator.devicePort(),
			history: simulator.executionHistory,
			services: simulator,
		}
	}

	dispose() {
		this.simulator.onProgress = null
		this.simulator.stop()
	}
}
