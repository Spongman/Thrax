import { BufferedConsole } from '../console'

export interface ConsoleMemory {
	valid(address: number, size: number): boolean
	byte(address: number): number
	store(address: number, value: number): void
}

/** The supported console/heap environment. Native adapters select syscall numbers,
 * registers, result widths, supervisor outcomes and memory access rules. */
export class LinuxConsole extends BufferedConsole {
	exitCode = -1
	programBreak = 0
	initialBreak = 0

	write(fd: number, address: number, count: number, memory: ConsoleMemory): number {
		if (fd !== 1 && fd !== 2) return -9 // EBADF
		if (count && !this.valid(memory, address, count)) return -14 // EFAULT
		let text = ''
		for (let index = 0; index < count; index++) text += String.fromCharCode(memory.byte(address + index))
		this.output += text
		return count
	}

	/** null means wait; no input or guest memory is consumed in that case. */
	read(fd: number, address: number, wanted: number, memory: ConsoleMemory): number | null {
		if (fd !== 0) return -9
		if (wanted === 0) return 0
		if (!this.available) {
			this.waiting = true
			return null
		}
		const count = Math.min(wanted, this.available)
		if (!this.valid(memory, address, count)) return -14
		for (let index = 0; index < count; index++) memory.store(address + index, this.readByte(true)!)
		this.waiting = false
		return count
	}

	brk(wanted: number, limit: number): number {
		if (Number.isSafeInteger(wanted) && wanted >= this.initialBreak && wanted <= limit) this.programBreak = wanted
		return this.programBreak
	}

	private valid(memory: ConsoleMemory, address: number, count: number): boolean {
		return Number.isSafeInteger(address) && address >= 0 && Number.isSafeInteger(address + count) && memory.valid(address, count)
	}
}
