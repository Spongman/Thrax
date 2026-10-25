import { afterEach, expect } from 'vitest'
import definition from '../index'
import type { ArchitectureServices, AssembledProgram, Machine } from '../../contracts'
import type { TargetSettings } from '../../../core/settings'

export const MODEL_30: TargetSettings = { cpuModel: '360-30', decimal: false, floatingPoint: false }
export const MODEL_50: TargetSettings = { cpuModel: '360-50', decimal: true, floatingPoint: true }
export const S370: TargetSettings = { cpuModel: '370', decimal: true, floatingPoint: true }

const live: ArchitectureServices[] = []
afterEach(() => { for (const services of live.splice(0)) services.dispose() })

export async function assemble(code: string, settings: TargetSettings = MODEL_50): Promise<{ program: AssembledProgram, services: ArchitectureServices }> {
	const services = definition.createServices()
	live.push(services)
	await services.prepare?.(settings)
	return { program: services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings), services }
}

/** Assemble cleanly and build a machine with history. */
export async function load(code: string, settings: TargetSettings = MODEL_50): Promise<Machine> {
	const { program, services } = await assemble(code, settings)
	expect(program.diagnostics).toEqual([])
	return services.createMachine(program, settings, { speed: null, historyLimit: 100000 })
}

export function run(machine: Machine, limit = 1_000_000) {
	for (let i = 0; i < limit && !machine.halted && !machine.pendingInput; i++) machine.step()
}

/** Wrap body lines in a CSECT with a base register; the program exits through SVC 3. */
export const program = (body: string, data = '') => `T        CSECT\n         BALR  12,0\n         USING *,12\n${body}\n         SVC   3\n${data}\n         LTORG\n         END   T\n`

/** One source line in the conventional columns: name 1, operation 10, operands 16. */
export const line = (op: string, operands = '', label = '') => `${label.padEnd(8)} ${op.padEnd(5)} ${operands}`.trimEnd()

export const imageBytes = (program: AssembledProgram, address: number, length: number) => {
	const section = program.image().sections.find(s => address >= s.address && address + length <= s.address + s.bytes.length)
	if (!section) throw new Error(`No image bytes at ${address.toString(16)}`)
	return [...section.bytes.subarray(address - section.address, address - section.address + length)]
}
