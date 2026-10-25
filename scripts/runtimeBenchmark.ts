import { activateArchitecture, knownArchitectures } from '../src/architectures/registry'
import { variantOf, type ArchitectureDefinition, type Machine } from '../src/architectures/contracts'
import { variantConfigurations } from '../src/core/variants'
import { createToolRegistry } from '../src/tools/registry'

interface Options { steps: number, samples: number, architectures?: string[] }

function configurations(definition: ArchitectureDefinition) {
	const defaults = definition.settings.defaults
	const out = [{ label: 'default', settings: defaults }]
	for (const settings of variantConfigurations(definition.settings)) {
		const changes = Object.entries(settings).filter(([key, value]) => value !== defaults[key])
		if (changes.length) out.push({ label: changes.map(([key, value]) => `${key}=${value}`).join(','), settings })
	}
	return out
}

function timed<T>(work: () => T) {
	const start = performance.now()
	const value = work()
	return { value, ms: performance.now() - start }
}

function measure(machine: Machine, steps: number, watched: boolean) {
	const tools = createToolRegistry()
	tools.attach(machine, machine.toolConfig())
	if (watched) tools.setWanted(new Set(['statistics', 'profile', 'cache', 'branchHistory', 'pipeline', 'memoryReference']))
	const execution = timed(() => {
		for (let n = 0; n < steps && !machine.halted && !machine.pendingInput; n++) machine.step()
		return machine.instructionCount
	})
	// Settle/allocate snapshots before measuring rewind; replay is lazy.
	const snapshotMs = timed(() => tools.views()).ms
	const retention = machine.history.retention!
	const rewindCount = Math.floor(machine.historyCursor / 2)
	const rewind = timed(() => {
		let count = 0
		while (count < rewindCount && machine.stepBack()) count++
		return count
	})
	const rewindToolsMs = timed(() => tools.views()).ms
	const replay = timed(() => {
		const target = machine.historyCursor + rewind.value
		let count = 0
		while (machine.historyCursor < target && count < rewind.value) { machine.step(); count++ }
		if (machine.historyCursor !== target) throw new Error('Retained replay did not reach its original cursor')
		return count
	})
	const replayToolsMs = timed(() => tools.views()).ms
	tools.detach()
	return {
		instructions: execution.value, executionMs: execution.ms, instructionsPerSecond: execution.value * 1000 / execution.ms,
		snapshotMs, rewindEntries: rewind.value, rewindMs: rewind.ms, rewindToolsMs,
		replayEntries: replay.value, replayMs: replay.ms, replayToolsMs,
		retention, liveBytesPerEntry: retention.liveBufferBytes / Math.max(1, retention.entries),
	}
}

export async function runBenchmark(options: Options, progress: (label: string) => void) {
	const rows = []
	for (const id of options.architectures ?? knownArchitectures()) {
		const { definition } = await activateArchitecture(id)
		for (const configuration of configurations(definition)) {
			const services = definition.createServices()
			try {
				const { settings, label } = configuration
				const code = variantOf(definition, settings).examples.mandelbrot.code
				await services.prepare?.(settings)
				const program = services.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
				const errors = program.diagnostics.filter(d => d.severity === 'error')
				if (errors.length) throw new Error(`${id}/${label}: ${errors.map(d => d.message).join(', ')}`)
				for (const mode of [{ historyLimit: 2000, tools: false }, { historyLimit: 1000000, tools: false }, { historyLimit: 1000000, tools: true }]) {
					progress(`${id}/${label} history=${mode.historyLimit} tools=${mode.tools}`)
					const samples = []
					for (let sample = -1; sample < options.samples; sample++) {
						(globalThis as typeof globalThis & { gc?: () => void }).gc?.()
						const machine = services.createMachine(program, settings, { speed: null, historyLimit: mode.historyLimit })
						try {
							const result = measure(machine, sample < 0 ? Math.min(10000, options.steps) : options.steps, mode.tools)
							if (sample >= 0) samples.push(result)
						} finally { machine.dispose() }
					}
					// Keep one actual median run, so all timings and retention belong together.
					samples.sort((a, b) => a.executionMs - b.executionMs)
					rows.push({ architecture: id, variant: label, settings, ...mode, median: samples[Math.floor(samples.length / 2)], samples })
				}
			} finally { services.dispose() }
		}
	}
	return rows
}
