import { describe, expect, it, vi } from 'vitest'
import { ExecutionController, ExecutionStep, type ExecutionClock } from '../executionController'

function fixture() {
	let time = 0
	let speed: number | null = null
	let paced: ReadonlySet<number> | null = null
	let depth = 0
	const host = { pc: 0, paused: false, halted: false, breakpoints: new Set<number>(), onProgress: vi.fn(), step: () => { host.pc++ } }
	const clock: ExecutionClock = {
		now: () => time,
		yield: vi.fn(async () => { time++ }),
		sleep: vi.fn(async (ms) => { time += ms }),
	}
	const backend = { speed: () => speed, pacedAddresses: () => paced, depth: () => depth }
	const controller = new ExecutionController(host, backend, clock)
	return { host, clock, controller, backend, speed: (value: number | null) => { speed = value }, paced: (value: ReadonlySet<number>) => { paced = value }, depth: (value: number) => { depth = value }, advanceTime: (ms: number) => { time += ms } }
}

describe('shared execution policy', () => {
	it('yields a paced run made entirely of code without source rows', async () => {
		const f = fixture()
		f.speed(30)
		f.paced(new Set())
		f.clock.yield = vi.fn(async () => { f.controller.pause() })
		await f.controller.runUntil(() => false)
		expect(f.host.pc).toBe(20_000)
		expect(f.clock.yield).toHaveBeenCalledOnce()
		expect(f.controller.running).toBe(false)
	})

	it('bounds a batch by host time even when individual steps are expensive', async () => {
		const f = fixture()
		f.host.step = () => { f.host.pc++; f.advanceTime(1) }
		f.clock.yield = vi.fn(async () => { f.controller.pause() })
		await f.controller.runUntil(() => false)
		expect(f.host.pc).toBe(64)
	})

	it('steps off the starting breakpoint and preserves every user breakpoint', async () => {
		const f = fixture()
		f.host.breakpoints.add(0).add(3)
		await f.controller.runUntil(() => false)
		expect(f.host.pc).toBe(3)
		expect(f.host.paused).toBe(true)
		expect([...f.host.breakpoints]).toEqual([0, 3])
	})

	it('does not confuse a deeper recursive return with the original call returning', async () => {
		const f = fixture()
		let step = 0
		f.depth(1)
		f.host.step = () => {
			step++
			f.host.pc = step === 1 ? 1 : 4
			f.depth(step === 1 ? 2 : step === 2 ? 3 : 1)
		}
		await f.controller.stepOver(4)
		expect(step).toBe(3)
		expect(f.host.pc).toBe(4)
	})

	it('runs off the current address before completing Run To that same address', async () => {
		const f = fixture()
		let steps = 0
		f.host.step = () => { f.host.pc = (++steps) % 3 }
		await f.controller.runTo(0)
		expect(steps).toBe(3)
		expect(f.host.pc).toBe(0)
	})

	it('cleans up running state after a fault without changing breakpoint ownership', async () => {
		const f = fixture()
		f.host.breakpoints.add(4)
		f.host.step = () => { throw new Error('guest fault') }
		await expect(f.controller.stepOver(4)).rejects.toThrow('guest fault')
		expect(f.controller.running).toBe(false)
		expect([...f.host.breakpoints]).toEqual([4])
	})

	it('does not let an old cancelled run clear or advance a newer run', async () => {
		const f = fixture()
		const yields: (() => void)[] = []
		f.clock.yield = () => new Promise((resolve) => yields.push(resolve))
		const old = f.controller.runUntil(() => false, 1)
		expect(f.host.pc).toBe(1)
		f.controller.pause()
		const current = f.controller.runUntil(() => false, 1)
		expect(f.host.pc).toBe(2)
		yields[0]()
		await old
		expect(f.controller.running).toBe(true)
		expect(f.host.pc).toBe(2)
		f.controller.dispose()
		yields[1]()
		await current
		expect(f.host.pc).toBe(2)
		expect(f.host.onProgress).toHaveBeenCalledTimes(2)
	})

	it('changes speed during a sliced wait without accumulating a large catch-up burst', async () => {
		const f = fixture()
		f.speed(1)
		f.clock.sleep = vi.fn(async (ms) => { f.advanceTime(ms); f.speed(null) })
		await f.controller.runUntil(() => f.host.pc >= 3)
		expect(f.host.pc).toBe(3)
		expect(f.clock.sleep).toHaveBeenCalledTimes(1)
		expect(f.clock.sleep).toHaveBeenCalledWith(50)
	})

	it('leaves a waiting backend idle and pauses on an explicit native wait result', async () => {
		const f = fixture()
		const backend = { ...f.backend, ready: () => false, step: vi.fn(() => ExecutionStep.WAIT) }
		const controller = new ExecutionController(f.host, backend, f.clock)
		await controller.runUntil(() => false)
		expect(backend.step).not.toHaveBeenCalled()
		backend.ready = () => true
		await controller.runUntil(() => false)
		expect(backend.step).toHaveBeenCalledOnce()
		expect(f.host.paused).toBe(true)
	})
})
