import { BufferedConsole } from '../../core/console'
/**
 * The console a program reaches through SWIs while it leaves the SWI vector
 * unprogrammed: a few calls numbered and named as RISC OS numbers them.
 *
 *   OS_WriteC  &00  writes the low byte of R0
 *   OS_WriteS  &01  writes the zero-terminated string after the SWI, and
 *                   resumes at the next word after it
 *   OS_Write0  &02  writes the zero-terminated string at R0; R0 ends past
 *                   the terminator
 *   OS_NewLine &03  writes a line feed
 *   OS_ReadC   &04  reads a character into R0 and clears C, waiting for
 *                   input when there is none; a line ends with 10
 *   OS_Exit    &11  ends the program
 *
 * The X forms (bit 17 set, XOS_WriteC and so on) behave the same, as these
 * calls cannot fail.  Any other number stops the run as an unknown SWI.
 */

import { FLAG_C } from '../arm/a32/isa'
import { SWI_HALT, SWI_JUMPED, SWI_NEXT, SWI_UNKNOWN, SWI_WAIT, type Arm26Cpu, type Arm26SwiHandler } from './cpu'

export const OS_WRITEC = 0x00
export const OS_WRITES = 0x01
export const OS_WRITE0 = 0x02
export const OS_NEWLINE = 0x03
export const OS_READC = 0x04
export const OS_EXIT = 0x11
/** Bit 17: return errors rather than raise them. */
export const X_BIT = 0x20000

const NAMES: readonly [string, number][] = [
	['OS_WriteC', OS_WRITEC], ['OS_WriteS', OS_WRITES], ['OS_Write0', OS_WRITE0],
	['OS_NewLine', OS_NEWLINE], ['OS_ReadC', OS_READC], ['OS_Exit', OS_EXIT],
]

/** Every SWI name a program may use, X forms included. */
export const SWI_NAMES: ReadonlyMap<string, number> = new Map([
	...NAMES,
	...NAMES.map(([name, number]): [string, number] => [`X${name}`, number | X_BIT]),
])

/** Longest string OS_Write0 and OS_WriteS will print. */
const MAX_STRING = 65536

export class Arm26Os extends BufferedConsole implements Arm26SwiHandler {


	execute(cpu: Arm26Cpu, comment: number): number {
		switch (comment & ~X_BIT) {
			case OS_WRITEC:
				this.output += String.fromCharCode(cpu.register(0) & 0xFF)
				return SWI_NEXT
			case OS_WRITES: {
				const end = this.write(cpu, cpu.pc + 4)
				cpu.jump((end + 4) & ~3)
				return SWI_JUMPED
			}
			case OS_WRITE0:
				cpu.writeRegister(0, this.write(cpu, cpu.register(0) >>> 0) + 1)
				return SWI_NEXT
			case OS_NEWLINE:
				this.output += '\n'
				return SWI_NEXT
			case OS_READC: {
				if (this.inputIndex >= this.input.length) {
					this.waiting = true
					return SWI_WAIT
				}
				this.waiting = false
				cpu.writeRegister(0, this.input.charCodeAt(this.inputIndex++) & 0xFF)
				cpu.setFlags(cpu.psr & ~FLAG_C)
				return SWI_NEXT
			}
			case OS_EXIT: return SWI_HALT
			default: return SWI_UNKNOWN
		}
	}

	/** Writes the string at `address`; returns the terminator's address. */
	private write(cpu: Arm26Cpu, address: number): number {
		let at = address
		let text = ''
		for (let byte = cpu.readByte(at); byte > 0 && text.length < MAX_STRING; byte = cpu.readByte(++at)) text += String.fromCharCode(byte)
		this.output += text
		return at
	}
}
