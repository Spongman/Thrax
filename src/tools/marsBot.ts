/**
 * Mars Bot: an MMIO-driven robot that leaves a trail as it moves.
 *
 * Five memory-mapped registers starting at 0xffff8000
 * (`Globals.memory.addObserver(this, 0xffff8000, 0xffff8060)`, :263):
 *
 *   0xffff8010  heading      degrees, 0 = north (up), clockwise (:17, :286-290)
 *   0xffff8020  leave track  0/1, edge-triggered start/end of a trail segment (:18, :292-328)
 *   0xffff8030  where-are-we-X  bot writes its X back here (:19, :112) - ignored on read (:336-343)
 *   0xffff8040  where-are-we-Y  bot writes its Y back here (:20, :113) - ignored on read (:336-343)
 *   0xffff8050  move         0 = stopped, nonzero = moving (:21, :329-334)
 *
 * MOVEMENT CLOCK. MARS moves the bot on its own thread, sleeping 40ms between
 * ticks (:145-152) - a wall-clock cadence with no THRAX equivalent; the
 * observer seam only fires on simulated events. Two candidates: tick on every
 * memory write (arbitrary - a bot left "moving" through an unrelated stretch
 * of stack traffic would drift only when the program happens to touch memory,
 * and would sit still through a register-only delay loop) or tick on every
 * `onInstruction` while MOVE is on (chosen here). The latter reproduces the
 * one property that matters observably - continuous movement, decoupled from
 * what kind of work the program is doing - using "one instruction" as the unit
 * of time instead of "40ms". The cost: speed is coupled to instruction count,
 * not wall time. MARS's own bot advances one step per fixed 40ms regardless of
 * the MIPS program; this port advances one step per *instruction*, so a delay
 * loop of a different length between toggling MOVE off changes the apparent
 * speed and track length, where real MARS would not. There is no host-neutral
 * way around this without a wall-clock or a cycle-accurate timing model, and
 * neither exists in THRAX.
 *
 * ROLLING BACK. The bot's position is a running vector sum and its track array
 * advances only on leave-track edges, so there is no closed-form inverse of
 * "undo the last N ticks" the way there is for a counter.  What there is
 * instead is the machine's own log: as an instruction moves the bot, it says
 * what the bot held before, and the machine hands that back when the run moves
 * over that instruction either way (see `core/service`).  So the bot rolls back
 * exactly, at the cost of a few columns per tick and nothing at all while it is
 * standing still.
 */

import type { Decoded } from '../core/decoder'
import type { MachineConfig } from '../core/observer'
import type { MachineService, ServiceRecorder, ServiceState } from '../core/service'
import type { ExecutionObserver } from '../core/observer'

const ADDR_HEADING = 0xffff8010
const ADDR_LEAVE_TRACK = 0xffff8020
const ADDR_WHERE_X = 0xffff8030
const ADDR_WHERE_Y = 0xffff8040
const ADDR_MOVE = 0xffff8050

export interface Point {
	x: number
	y: number
}

export interface TrackSegment {
	from: Point
	to: Point
}

export interface MarsBotSnapshot {
	heading: number
	x: number
	y: number
	moving: boolean
	leavingTrack: boolean
	/** Completed and in-progress trail segments, in the order they were drawn. */
	segments: TrackSegment[]
}

/** What the bot calls the parts of itself, in the records it keeps. */
const SLOT_X = 0
const SLOT_Y = 1
const SLOT_POINT = 2
const SLOT_HEADING = 3
const SLOT_MOVING = 4
const SLOT_LEAVING = 5
const SLOT_INDEX = 6

export class MarsBot implements ExecutionObserver, MachineService {
	readonly name = 'Mars Bot'
	/** Where changes are filed, once the machine has offered somewhere. */
	private recorder: ServiceRecorder | null = null
	private heading = 0
	private leavingTrack = false
	private moving = false
	private x = 0
	private y = 0
	/** arrayOfTrack/trackIndex, grown as needed rather than fixed at 256. */
	private track: Point[] = []
	private trackIndex = 0

	onConfigure(machine: MachineConfig) {
		this.recorder = machine.services?.register(this) ?? null
	}

	/**
	 * Puts one part of the bot back to what it was, and hands over what it held
	 * instead, so the same record serves going back and going forward.
	 */
	exchange(slot: number, value: number, payload: unknown): ServiceState {
		switch (slot) {
			case SLOT_X: {
				const held = this.x
				this.x = payload as number
				return { value, payload: held }
			}
			case SLOT_Y: {
				const held = this.y
				this.y = payload as number
				return { value, payload: held }
			}
			// The point the tick overwrote, which is empty until a tick lands on it.
			case SLOT_POINT: {
				const held = this.track[value]
				if (payload === undefined) delete this.track[value]
				else this.track[value] = payload as Point
				return { value, payload: held }
			}
			case SLOT_HEADING: {
				const held = this.heading
				this.heading = value
				return { value: held }
			}
			case SLOT_MOVING: {
				const held = this.moving
				this.moving = value !== 0
				return { value: held ? 1 : 0 }
			}
			case SLOT_LEAVING: {
				const held = this.leavingTrack
				this.leavingTrack = value !== 0
				return { value: held ? 1 : 0 }
			}
			case SLOT_INDEX: {
				const held = this.trackIndex
				this.trackIndex = value
				return { value: held }
			}
		}
		return { value }
	}

	reset() {
		this.heading = 0
		this.leavingTrack = false
		this.moving = false
		this.x = 0
		this.y = 0
		this.track = []
		this.trackIndex = 0
	}

	onReset() {
		this.reset()
	}

	/**
	 * One MMIO write. `value` is optional only because the current observer
	 * seam cannot supply it (see the header) - a write with no value is a
	 * documented no-op, not a guess.
	 */
	onMemoryWrite(address: number, _size: number, value: number) {
		switch (address >>> 0) {
			case ADDR_HEADING:
				this.recorder?.keep(SLOT_HEADING, this.heading)
				this.heading = value
				break
			case ADDR_LEAVE_TRACK:
				this.setLeavingTrack(value !== 0)
				break
			case ADDR_MOVE:
				this.recorder?.keep(SLOT_MOVING, this.moving ? 1 : 0)
				this.moving = value !== 0
				break
			// ADDR_WHERE_X/Y and anything else in the bot's range: ignored,
			// matching fall-through and its explicit
			// "these writes originated within this tool" comment at :339-341.
		}
	}

	/**
	 * MARS's timer tick (see header); this stands in for it. Any executed
	 * instruction counts, matching the free-running, work-independent nature
	 * of the real thread.
	 */
	onInstruction(_address: number, _decoded: Decoded) {
		if (!this.moving) return
		this.advance()
	}

	/**: one unit step in the current heading's direction. */
	private advance() {
		this.recorder?.keep(SLOT_X, 0, this.x)
		this.recorder?.keep(SLOT_Y, 0, this.y)
		this.recorder?.keep(SLOT_POINT, this.trackIndex, this.track[this.trackIndex])
		const mathAngle = ((360 - this.heading) + 90) % 360
		const radians = (mathAngle * Math.PI) / 180
		this.x += Math.cos(radians)
		this.y -= Math.sin(radians) // MARS negates because screen Y grows downward.
		//: overwritten every tick regardless of leavingTrack -
		// while not leaving a track this just keeps a fresh "current point" on
		// hand for whenever leaving track starts; while leaving one, this is
		// what makes the in-progress segment's end grow live.
		this.track[this.trackIndex] = { x: this.x, y: this.y }
	}

	/** four-way branch, collapsed to the two edges that act. */
	private setLeavingTrack(want: boolean) {
		if (want === this.leavingTrack) return
		this.recorder?.keep(SLOT_LEAVING, this.leavingTrack ? 1 : 0)
		this.recorder?.keep(SLOT_POINT, this.trackIndex, this.track[this.trackIndex])
		this.recorder?.keep(SLOT_INDEX, this.trackIndex)
		this.leavingTrack = want
		this.track[this.trackIndex] = { x: this.x, y: this.y }
		this.trackIndex += 1
	}

	snapshot(): MarsBotSnapshot {
		const segments: TrackSegment[] = []
		// draws pairs (i-1,i) for i=1,3,5,...<=trackIndex; an
		// odd trackIndex still draws its last, in-progress pair (see advance()).
		for (let i = 1; i <= this.trackIndex; i += 2) {
			const from = this.track[i - 1]
			const to = this.track[i]
			if (from && to) segments.push({ from, to })
		}
		return {
			heading: this.heading,
			x: this.x,
			y: this.y,
			moving: this.moving,
			leavingTrack: this.leavingTrack,
			segments,
		}
	}
}

export const MARS_BOT_ADDRESSES = {
	heading: ADDR_HEADING,
	leaveTrack: ADDR_LEAVE_TRACK,
	whereX: ADDR_WHERE_X,
	whereY: ADDR_WHERE_Y,
	move: ADDR_MOVE,
} as const
