import { describe, expect, it } from 'vitest'
import { build, withExit } from '../../core/__tests__/helpers'
import { MARS_BOT_ADDRESSES, MarsBot } from '../marsBot'

const { heading: ADDR_HEADING, leaveTrack: ADDR_LEAVE_TRACK, whereX: ADDR_WHERE_X, whereY: ADDR_WHERE_Y, move: ADDR_MOVE } = MARS_BOT_ADDRESSES

describe('Mars Bot', () => {
	it('sets heading from a write to the heading register', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_HEADING, 4, 90)
		expect(bot.snapshot().heading).toBe(90)
	})

	it('starts and stops moving from a write to the move register', () => {
		const bot = new MarsBot()
		expect(bot.snapshot().moving).toBe(false)
		bot.onMemoryWrite(ADDR_MOVE, 4, 1)
		expect(bot.snapshot().moving).toBe(true)
		bot.onMemoryWrite(ADDR_MOVE, 4, 0)
		expect(bot.snapshot().moving).toBe(false)
	})

	it('toggles leaving-track from a write to the leave-track register', () => {
		const bot = new MarsBot()
		expect(bot.snapshot().leavingTrack).toBe(false)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 1)
		expect(bot.snapshot().leavingTrack).toBe(true)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 0)
		expect(bot.snapshot().leavingTrack).toBe(false)
	})

	it('ignores the where-are-we registers, matching MarsBot.java:336-343', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_WHERE_X, 4, 12345)
		bot.onMemoryWrite(ADDR_WHERE_Y, 4, 67890)
		const snapshot = bot.snapshot()
		expect(snapshot.x).toBe(0)
		expect(snapshot.y).toBe(0)
	})

	it('ignores a write outside its MMIO range', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(0xffff8000, 4, 1) // in the addObserver range, but not one of the five registers
		bot.onMemoryWrite(0x10010000, 4, 1) // ordinary data segment
		const snapshot = bot.snapshot()
		expect(snapshot).toEqual({ heading: 0, x: 0, y: 0, moving: false, leavingTrack: false, segments: [] })
	})


	it('does not move while MOVE is off, even with a heading set', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_HEADING, 4, 90)
		bot.onInstruction(0, {} as never)
		bot.onInstruction(0, {} as never)
		const snapshot = bot.snapshot()
		expect(snapshot.x).toBe(0)
		expect(snapshot.y).toBe(0)
	})

	it.each([
		[0, 0, -1], // north: up (screen Y decreases)
		[90, 1, 0], // east: right (screen X increases)
		[180, 0, 1], // south: down (screen Y increases)
		[270, -1, 0], // west: left (screen X decreases)
	])('heading %i degrees moves one step toward (%i, %i)', (headingDegrees, dx, dy) => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_HEADING, 4, headingDegrees)
		bot.onMemoryWrite(ADDR_MOVE, 4, 1)
		bot.onInstruction(0, {} as never)
		const snapshot = bot.snapshot()
		expect(snapshot.x).toBeCloseTo(dx)
		expect(snapshot.y).toBeCloseTo(dy)
	})

	it('accumulates several steps in the same heading', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_HEADING, 4, 90) // east
		bot.onMemoryWrite(ADDR_MOVE, 4, 1)
		bot.onInstruction(0, {} as never)
		bot.onInstruction(0, {} as never)
		bot.onInstruction(0, {} as never)
		const snapshot = bot.snapshot()
		expect(snapshot.x).toBeCloseTo(3)
		expect(snapshot.y).toBeCloseTo(0)
	})

	it('records no segment while moving with leave-track off', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_HEADING, 4, 90)
		bot.onMemoryWrite(ADDR_MOVE, 4, 1)
		bot.onInstruction(0, {} as never)
		bot.onInstruction(0, {} as never)
		expect(bot.snapshot().segments).toEqual([])
	})

	it('records a segment from where leave-track turned on to where it turned off', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_HEADING, 4, 90) // east
		bot.onMemoryWrite(ADDR_MOVE, 4, 1)
		bot.onInstruction(0, {} as never) // (1, 0), not yet leaving a track
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 1) // start of segment: (1, 0)
		bot.onInstruction(0, {} as never) // (2, 0)
		bot.onInstruction(0, {} as never) // (3, 0)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 0) // end of segment: (3, 0)

		const { segments } = bot.snapshot()
		expect(segments).toHaveLength(1)
		expect(segments[0].from.x).toBeCloseTo(1)
		expect(segments[0].to.x).toBeCloseTo(3)
	})

	it('grows the in-progress segment live while still leaving a track', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_HEADING, 4, 90)
		bot.onMemoryWrite(ADDR_MOVE, 4, 1)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 1) // start of segment: (0, 0)
		bot.onInstruction(0, {} as never) // (1, 0)

		let segments = bot.snapshot().segments
		expect(segments).toHaveLength(1)
		expect(segments[0].to.x).toBeCloseTo(1)

		bot.onInstruction(0, {} as never) // (2, 0), segment not closed yet
		segments = bot.snapshot().segments
		expect(segments).toHaveLength(1)
		expect(segments[0].to.x).toBeCloseTo(2)
	})

	it('starts a second segment after the first closes', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_HEADING, 4, 90)
		bot.onMemoryWrite(ADDR_MOVE, 4, 1)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 1)
		bot.onInstruction(0, {} as never) // (1, 0)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 0) // segment 1: (0,0) -> (1,0)
		bot.onInstruction(0, {} as never) // (2, 0), not leaving a track
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 1) // segment 2 starts at (2, 0)
		bot.onInstruction(0, {} as never) // (3, 0)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 0) // segment 2: (2,0) -> (3,0)

		const { segments } = bot.snapshot()
		expect(segments).toHaveLength(2)
		expect(segments[0].from.x).toBeCloseTo(0)
		expect(segments[0].to.x).toBeCloseTo(1)
		expect(segments[1].from.x).toBeCloseTo(2)
		expect(segments[1].to.x).toBeCloseTo(3)
	})

	it('a redundant leave-track write of the same state is a no-op', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 0) // already off: MarsBot.java:306-309
		expect(bot.snapshot().leavingTrack).toBe(false)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 1)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 1) // already on: MarsBot.java:312-315
		const before = bot.snapshot().segments.length
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 1)
		expect(bot.snapshot().segments.length).toBe(before)
	})

	it('clears everything on reset', () => {
		const bot = new MarsBot()
		bot.onMemoryWrite(ADDR_HEADING, 4, 90)
		bot.onMemoryWrite(ADDR_MOVE, 4, 1)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 1)
		bot.onInstruction(0, {} as never)
		bot.onMemoryWrite(ADDR_LEAVE_TRACK, 4, 0)

		bot.onReset()

		expect(bot.snapshot()).toEqual({ heading: 0, x: 0, y: 0, moving: false, leavingTrack: false, segments: [] })
	})

	it('takes its heading from a program driving the real simulator', async () => {
		// ADDR_HEADING does not fit a signed 16-bit sw offset, so build it in a register.
		const simulator = build(withExit('li $t0, 90\nlui $t1, 0xffff\nori $t1, $t1, 0x8010\nsw $t0, 0($t1)'))
		const bot = new MarsBot()
		simulator.observers.push(bot)
		await simulator.run()

		// The seam carries the written value, so the store reaches the bot.
		expect(bot.snapshot().heading).toBe(90)
	})
})
