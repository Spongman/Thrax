/**
 * The register panel's view: R0-R14 as the current mode sees them, the PC,
 * the status bits as flags with R15 whole beside them, and every banked
 * register on a tab of its own.
 */

import { RegisterFormat, type RegisterBank, type RegisterDescriptor } from '../contracts'
import { MODE_FIQ, MODE_IRQ, MODE_SVC, MODE_USR, PHYSICAL_COUNT, PHYSICAL_FIQ, PHYSICAL_IRQ, PHYSICAL_SVC, PHYSICAL_USR } from './cpu'

export const ARM26_BANKS: readonly RegisterBank[] = Object.freeze([
	{ id: 'registers', label: 'Registers' },
	{ id: 'banked', label: 'Banked' },
])

/** Status flags by descriptor id, and the R15 bit each reads. */
export const FLAG_BITS: Readonly<Record<string, number>> = Object.freeze({ N: 31, Z: 30, C: 29, V: 28, I: 27, F: 26 })

const NAMES: Readonly<Record<number, string>> = { 13: 'SP', 14: 'LR' }
const ROLES: Readonly<Record<number, RegisterDescriptor['role']>> = { 13: 'stackPointer', 14: 'link' }

/** Descriptor id of each physical register, as the Banked tab lists it. */
export const PHYSICAL_IDS: readonly string[] = Object.freeze(Array.from({ length: PHYSICAL_COUNT }, (_unused, index) => {
	if (index < PHYSICAL_USR) return `R${index}`
	if (index < PHYSICAL_FIQ) return `R${index}_usr`
	if (index < PHYSICAL_IRQ) return `R${index - PHYSICAL_FIQ + 8}_fiq`
	if (index < PHYSICAL_SVC) return `R${index - PHYSICAL_IRQ + 13}_irq`
	return `R${index - PHYSICAL_SVC + 13}_svc`
}))

/** Which mode a banked physical register belongs to. */
export function physicalMode(index: number): number {
	if (index < PHYSICAL_FIQ) return MODE_USR
	if (index < PHYSICAL_IRQ) return MODE_FIQ
	if (index < PHYSICAL_SVC) return MODE_IRQ
	return MODE_SVC
}

const banked = (index: number): RegisterDescriptor => {
	const id = PHYSICAL_IDS[index]
	return Object.freeze({ id, name: id, bank: 'banked', group: ['User', 'FIQ', 'IRQ', 'SVC'][physicalMode(index)], bits: 32, editable: true })
}

export const ARM26_REGISTERS: readonly RegisterDescriptor[] = Object.freeze([
	...Array.from({ length: 15 }, (_unused, index): RegisterDescriptor => Object.freeze({
		id: `R${index}`,
		name: NAMES[index] ?? `R${index}`,
		bank: 'registers',
		group: 'Registers',
		bits: 32,
		editable: true,
		aliases: Object.freeze(NAMES[index] ? [`R${index}`, `r${index}`, NAMES[index].toLowerCase()] : [`r${index}`]),
		...(ROLES[index] ? { role: ROLES[index] } : {}),
	})),
	Object.freeze({ id: 'PC', name: 'PC', bank: 'registers', group: 'Registers', bits: 32, editable: true, aliases: Object.freeze(['R15', 'r15', 'pc']), role: 'programCounter' as const }),
	...Object.keys(FLAG_BITS).map((name): RegisterDescriptor => Object.freeze({
		id: name, name, bank: 'registers', group: 'Status', bits: 1, editable: false, format: RegisterFormat.FLAG,
	})),
	Object.freeze({ id: 'PSR', name: 'R15', bank: 'registers', group: 'R15: status and PC', bits: 32, editable: true, role: 'flags' as const }),
	...Array.from({ length: PHYSICAL_COUNT - PHYSICAL_USR }, (_unused, offset) => banked(PHYSICAL_USR + offset)),
])
