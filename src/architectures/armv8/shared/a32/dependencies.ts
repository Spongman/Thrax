import { FORMAT_BLOCK, FORMAT_DATA, FORMAT_EXTRA_TRANSFER, FORMAT_MULTIPLY, FORMAT_STATUS, FORMAT_VFP } from './isa'
import { decodeVfp, VK_VMRS } from './vfp'
/** A32 aliases share R0..R15 resources; resource 16 represents the condition flags. */
export function a32Dependencies(word: number, readMask: number, writeMask: number, format: number) {
	const registers = (mask: number) => Array.from({ length: 16 }, (_, n) => n).filter(n => mask & (1 << n))
	const reads = registers(readMask), writes = registers(writeMask)
	const data = format === FORMAT_DATA
	const opcode = (word >>> 21) & 15
	// Conditional execution and carry-consuming arithmetic/shifts read status.
	if (word >>> 28 < 14 || (data && ([5, 6, 7].includes(opcode) || (word & 0x0e000070) === 0x60))) reads.push(16)
	if ((data || format === FORMAT_MULTIPLY) && (word & 0x00100000)) writes.push(16)
	if (format === FORMAT_STATUS) (word & 0x00200000 ? writes : reads).push(16)
	// VMRS APSR_nzcv, FPSCR writes the flags.
	if (format === FORMAT_VFP) {
		const v = decodeVfp(word)
		if (v?.kind === VK_VMRS && v.rt === 15) writes.push(16)
	}
	return { reads, writes }
}

/** Destinations delivered by memory, apart from an ALU-produced base writeback. */
export function a32LoadWrites(word: number, format: number): number[] {
	// VFP loads deliver to S and D registers, which are not tracked.
	if (format === FORMAT_VFP) return []
	if (format === FORMAT_BLOCK) return Array.from({ length: 16 }, (_, n) => n).filter(n => word & (1 << n))
	const destination = (word >>> 12) & 15
	return format === FORMAT_EXTRA_TRANSFER && !(word & 0x00100000)
		? [destination, (destination + 1) & 15] : [destination]
}
