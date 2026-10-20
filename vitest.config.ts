import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['src/**/*.test.{ts,tsx}'],
		// CPU regressions run substantial programs; avoid competing with too many emulator workers.
		maxWorkers: 4,
	},
})
