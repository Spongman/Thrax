import type { DebugInspection, TokenDescription } from '../contracts'
import { bitsToDouble, formatDouble } from '../../core/ieee754'

const hex = (bits: bigint) => `0x${bits.toString(16).padStart(16, '0')}`
const DYNAMIC = ['chopped', 'minus infinity', 'normal', 'plus infinity']
const STATUS: readonly [number, string][] = [[52, 'INV'], [53, 'DZE'], [54, 'OVF'], [55, 'UNF'], [56, 'INE'], [57, 'IOV']]
const DISABLES: readonly [number, string][] = [[49, 'INVD'], [50, 'DZED'], [51, 'OVFD'], [60, 'UNDZ'], [61, 'UNFD'], [62, 'INED']]

/** A T_floating register value; S values are held in the same layout. */
export const floatText = (bits: bigint) => formatDouble(bitsToDouble(Number(bits & 0xffffffffn), Number(bits >> 32n)))

export function fpcrText(bits: bigint): string {
	const set = (list: readonly [number, string][]) => list.filter(([bit]) => bits >> BigInt(bit) & 1n).map(([, name]) => name).join(' ') || 'none'
	return `dynamic rounding ${DYNAMIC[Number(bits >> 58n & 3n)]}; status ${set(STATUS)}; disables ${set(DISABLES)}`
}

/** Replace the shared integer tip of $fN and FPCR with their floating-point reading. */
export function describeFloatRegister(description: TokenDescription | null, text: string, state: DebugInspection): TokenDescription | null {
	const id = description?.register, value = id === undefined ? undefined : state.registers[id]
	if (!description || value === undefined || !/^f\d+$|^fpcr$/.test(id!)) return description
	const token = text.slice(description.start, description.start + description.length), bits = BigInt.asUintN(64, BigInt(value))
	return { ...description, contents: [`**${token}** = ${id === 'fpcr' ? hex(bits) : `${floatText(bits)} (${hex(bits)})`}`, ...id === 'fpcr' ? [fpcrText(bits)] : []] }
}
