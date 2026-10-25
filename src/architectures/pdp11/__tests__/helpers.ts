import { expect } from 'vitest'
import definition from '../index'
import type { Machine } from '../../contracts'
import type { TargetSettings } from '../../../core/settings'

export const EIS: TargetSettings = { cpuModel: 'pdp1140', floatingPoint: 'none' }
export const BASE: TargetSettings = { cpuModel: 'pdp1120', floatingPoint: 'none' }
export const FP11: TargetSettings = { cpuModel: 'pdp1145', floatingPoint: 'fp11' }
export const FIS: TargetSettings = { cpuModel: 'pdp1140', floatingPoint: 'fis' }

export async function assemble(code: string, settings: TargetSettings = EIS) {
	const services = definition.createServices()
	await services.prepare?.(settings)
	return { services, program: services.assemble({ files: [{ name: 'main.mac', code }], entries: ['main.mac'] }, settings) }
}

/** A machine over code that must assemble cleanly. */
export async function load(code: string, settings: TargetSettings = EIS): Promise<Machine> {
	const { services, program } = await assemble(code, settings)
	expect(program.diagnostics).toEqual([])
	return services.createMachine(program, settings, { speed: null, historyLimit: 10000 })
}

/** The words assembled from 1000, in octal. */
export async function words(code: string, settings: TargetSettings = EIS): Promise<string[]> {
	const machine = await load(code, settings)
	const memory = machine.inspectMemory(), out: string[] = []
	for (let a = 0o1000; memory.byte(a) !== undefined && out.length < 64; a += 2) out.push((memory.byte(a)! | memory.byte(a + 1)! << 8).toString(8).padStart(6, '0'))
	while (out.length && out[out.length - 1] === '000000') out.pop()
	return out
}

export function run(machine: Machine, limit = 100_000) {
	for (let i = 0; i < limit && !machine.halted; i++) machine.step()
	return machine
}
export const reg = (machine: Machine, id: string) => Number(machine.registerValues()[id])
export const word = (machine: Machine, address: number) => machine.inspectMemory().byte(address)! | machine.inspectMemory().byte(address + 1)! << 8
