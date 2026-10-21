import { createServer } from 'vite'
import { writeFile } from 'node:fs/promises'
import { cpus, platform, release } from 'node:os'

const args = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')))
const positive = (key, fallback) => {
	const value = Number(args.get(key) ?? fallback)
	if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${key} must be a positive integer`)
	return value
}
const options = { steps: positive('steps', 100000), samples: positive('samples', 3), architectures: args.get('architectures')?.split(',') }
const server = await createServer({ server: { middlewareMode: true, watch: null, open: false }, logLevel: 'error' })
try {
	const { runBenchmark } = await server.ssrLoadModule('/scripts/runtimeBenchmark.ts')
	const rows = await runBenchmark(options, label => process.stdout.write(`${label}\n`))
	const output = args.get('output') ?? 'docs/runtime-benchmark.json'
	await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), environment: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0]?.model }, options, rows }, null, 2)}\n`)
	process.stdout.write(`Saved ${rows.length} measurements to ${output}\n`)
} finally {
	await server.close()
}
