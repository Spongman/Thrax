/**
 * Scavenger Hunt: the MMIO multiplayer game. Up to 22 players share one MIPS
 * memory space, each polling their own 0x400-byte slot for move requests and
 * task work, gated by an administrator that authenticates whose turn is live.
 *
 * A memory-mapped treasure hunt.  Administrative registers, anyone may write the
 * first two, only the administrator (playerID === ADMINISTRATOR_ID) may flip
 * GAME_ON (:516, :541-560):
 *
 *   0xffffe000  authentication  one-time-pad value preceding a PLAYER_ID write (:47, :541-560)
 *   0xffffe004  player id       the currently "live" player, gated by authentication (:48, :541-560)
 *   0xffffe008  game on         administrator-only; (re)initializes the game (:49, :516-529)
 *   0xffffe00c  num turns       informational; anyone may write, no action taken (:50, :536-540)
 *
 * Per player, at `0xffff8000 + id * 0x400` (:57-70):
 *
 *   +0x00  where-am-i X   tool-owned; ignored on a player write (:112, falls to :712-719)
 *   +0x04  where-am-i Y   tool-owned; ignored on a player write
 *   +0x08  move-to X      player writes a destination, then...
 *   +0x0c  move-to Y      ...
 *   +0x10  move ready     ...a nonzero write here attempts the move (:562-655)
 *   +0x14  energy         read-only from the player's side; decremented per move, set by a task award
 *   +0x1c  player color    (:698-703)
 *   +0x124 task complete   a nonzero write checks the task array is sorted ascending (:658-694)
 *   +0x128 task array      20 words, mirrored as they are written
 *
 * PORT-SPECIFIC MIRRORING. MARS's `toolGetWord`/`toolReadPlayerData` peek live
 * MIPS memory on demand (:805, :849) whenever a rule needs another field -
 * for instance OFFSET_MOVE_TO_X/Y at the moment MOVE_READY is written. THRAX's
 * observer seam has no such live-peek API: a tool only ever learns of a write
 * at the moment it happens. So this port mirrors every field a rule depends
 * on (moveToX/Y, the task array, the authentication value) into its own state
 * as each write arrives, and consults the mirror instead of re-reading memory.
 * Behaviourally equivalent, given writes always precede the read that uses them
 * (matching this game's own protocol: write your destination, then MOVE_READY).
 *
 * THE ORIGINAL'S TWO UNFINISHED TODOs, IMPLEMENTED HERE.
 * The original's comment reads "TBD FUTURE --- need to keep track of
 * locations that the player has actually got to -- be able to tell that the
 * player has reached a certain location -- be able to tell that the player
 * has reached every location" - but the code immediately below it (:622-629)
 * already marks `hasVisitedLoc[i]` on an exact coordinate match, and "reached
 * every location" is already checked too, just not where that comment sits:
 * it happens lazily inside `ScavengerHuntDisplay.paintComponent` (:372-385),
 * a Swing repaint callback that runs on its own 100ms timer (:224), decoupled
 * from the MIPS program. That is a latent bug, not a missing feature: a
 * player's actual finishing moment is whatever repaint happens to run next,
 * so `finishTime` is not deterministic and can read low or late depending on
 * paint scheduling. This port fixes exactly that: `visited` and `finished`
 * are computed synchronously inside the move that causes them, addresses the
 * comment's own literal request "be able to tell", and `finishedAtInstruction`
 * (this port's clock, matching marsBot.ts's precedent of using instruction
 * count as a wall-clock stand-in) is captured at the instant of completion.
 *
 * The second TODO, at :709 ("Yet to be implemented: Enforce only one write of
 * MoveRequest per player per turn"), has no implementation anywhere in MARS -
 * a player whose ID is live can write MOVE_READY as many times as it likes
 * before the administrator authenticates the next turn. This port reads "per
 * turn" as "per span during which this player is the authenticated live
 * player": `movedThisTurn` is cleared whenever an authenticated PLAYER_ID
 * write makes a player live (whether or not the id actually changed - a
 * re-authentication is a new turn), and a further MOVE_READY write is ignored,
 * silently, the same way an out-of-bounds or too-far move already is.
 *
 * NOT REPRODUCED. The Swing GUI, its 100ms redraw timer, and the "Reset"
 * button (all cosmetic/host-specific); the illegal-write `JOptionPane` popup
 * (:735-738) is instead counted in `illegalWrites`, since a tool has no dialog
 * to raise and a silent drop would erase the one observable difference a
 * cheating write has from a legal one. Location and task-array randomisation
 * uses a small seeded PRNG local to this port, not `java.util.Random`, whose
 * bit sequence this does not reproduce - only determinism given a fixed seed
 * matters here, since placement and task numbers are not gameplay rules.
 *
 * H2b (onRewind) NOTE. Unlike T1's plain counters (order-independent, undone
 * by decrementing), this game's state is dominated by overwrite, not
 * accumulation: `playerId` is a last-write-wins identity switch, a player's
 * (x, y) is replaced outright by each successful move (not accumulated, so a
 * later distance check depends on knowing the immediately preceding position,
 * not just a running sum), `energy` is decremented per move but *overwritten*
 * flat to ENERGY_AWARD by a task completion (irreversible without the
 * pre-award value), and `visited`/`taskArray` are set-once/replaced-wholesale.
 * Only `authenticationValue` and the illegal-write counter are simple tallies.
 * That mix is the same shape T3 (MarsBot) concluded needs a checkpoint, not an
 * inverse: keep one snapshot of the whole accumulator state per
 * state-changing write (or per instruction), tagged by instruction count,
 * bounded like the machine's own backstepLimit; `onRewind(toInstructionCount)`
 * finds the last checkpoint at or before that count and restores it wholesale.
 */

import type { ExecutionObserver } from '../../../core/observer'

export const GRAPHIC_WIDTH = 712
export const GRAPHIC_HEIGHT = 652
export const NUM_PLAYERS = 22
export const MAX_MOVE_DISTANCE = 2.5
export const ENERGY_AWARD = 20
export const ENERGY_PER_MOVE = 1
export const SIZE_OF_TASK = 20
export const NUM_LOCATIONS = 7
export const START_AND_END_LOCATION = 255
export const ADMINISTRATOR_ID = 999

const ADDR_AUTHENTICATION = 0xffffe000
const ADDR_PLAYER_ID = 0xffffe004
const ADDR_GAME_ON = 0xffffe008
const ADDR_NUM_TURNS = 0xffffe00c

const ADDR_BASE = 0xffff8000
const ADDR_END = 0xfffffff0 // addObserver upper bound
const MEM_PER_PLAYER = 0x400

const OFFSET_MOVE_TO_X = 0x8
const OFFSET_MOVE_TO_Y = 0xc
const OFFSET_MOVE_READY = 0x10
const OFFSET_PLAYER_COLOR = 0x1c
const OFFSET_TASK_COMPLETE = 0x124
const OFFSET_TASK_ARRAY = 0x128

export const SCAVENGER_HUNT_ADDRESSES = {
	authentication: ADDR_AUTHENTICATION,
	playerId: ADDR_PLAYER_ID,
	gameOn: ADDR_GAME_ON,
	numTurns: ADDR_NUM_TURNS,
	base: ADDR_BASE,
	memPerPlayer: MEM_PER_PLAYER,
	offsets: {
		moveToX: OFFSET_MOVE_TO_X,
		moveToY: OFFSET_MOVE_TO_Y,
		moveReady: OFFSET_MOVE_READY,
		playerColor: OFFSET_PLAYER_COLOR,
		taskComplete: OFFSET_TASK_COMPLETE,
		taskArray: OFFSET_TASK_ARRAY,
	},
} as const

/** MIPS byte address of one player's field, for building test writes and for the panel. */
export function playerAddress(id: number, offset: number): number {
	return (ADDR_BASE + id * MEM_PER_PLAYER + offset) >>> 0
}

export interface Location {
	x: number
	y: number
}

export interface PlayerState {
	id: number
	x: number
	y: number
	energy: number
	color: number
	visited: boolean[]
	finished: boolean
	finishedAtInstruction: number | null
}

export interface ScavengerHuntSnapshot {
	gameOn: boolean
	/** ADMINISTRATOR_ID when no player is currently authenticated live. */
	activePlayerId: number
	numTurns: number
	locations: Location[]
	players: PlayerState[]
	/** Writes outside the live player's own slot; no dialog to raise, so counted. */
	illegalWrites: number
}

/** Small deterministic PRNG local to this port; see the header's NOT REPRODUCED note. */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

interface PlayerMirror {
	moveToX: number
	moveToY: number
	taskArray: number[]
	movedThisTurn: boolean
}

export class ScavengerHunt implements ExecutionObserver {
	private gameOn = false
	private authenticationValue = 0 // server-expected next auth value
	private authenticationMirror = 0 // last value the client wrote to ADDR_AUTHENTICATION
	private numTurns = 0
	private playerId = ADMINISTRATOR_ID
	private locations: Location[] = []
	private players: PlayerState[] = []
	private mirrors: PlayerMirror[] = []
	private illegalWrites = 0
	private instructionCount = 0

	constructor() {
		this.reset()
	}

	reset() {
		this.gameOn = false
		this.authenticationValue = 0
		this.authenticationMirror = 0
		this.numTurns = 0
		this.playerId = ADMINISTRATOR_ID
		this.illegalWrites = 0
		this.instructionCount = 0
		this.locations = []
		this.players = Array.from({ length: NUM_PLAYERS }, (_, id) => this.freshPlayer(id))
		this.mirrors = Array.from({ length: NUM_PLAYERS }, () => this.freshMirror())
	}

	onReset() {
		this.reset()
	}

	onInstruction(_address: number, _instruction: unknown) {
		this.instructionCount += 1
	}

	private freshPlayer(id: number): PlayerState {
		return {
			id,
			x: START_AND_END_LOCATION,
			y: START_AND_END_LOCATION,
			energy: 20, // PlayerData default
			color: 0,
			visited: new Array(NUM_LOCATIONS).fill(false),
			finished: false,
			finishedAtInstruction: null,
		}
	}

	private freshMirror(): PlayerMirror {
		return { moveToX: 0, moveToY: 0, taskArray: new Array(SIZE_OF_TASK).fill(0), movedThisTurn: false }
	}

	/**
	 * One MMIO write. `value` is optional only because the current observer
	 * seam cannot supply it (see the header) - a write with no value is a
	 * documented no-op.
	 */
	onMemoryWrite(address: number, _size: number, value: number) {
		const addr = address >>> 0
		if (addr < ADDR_BASE || addr >= ADDR_END) return // outside the tool's whole registered range

		if (addr === ADDR_GAME_ON) {
			if (this.playerId === ADMINISTRATOR_ID) this.initializeGame() //
			return
		}
		if (addr === ADDR_AUTHENTICATION) {
			this.authenticationMirror = value // "no action" beyond mirroring; see header's PORT-SPECIFIC MIRRORING note
			return
		}
		if (addr === ADDR_NUM_TURNS) {
			this.numTurns = value // informational only
			return
		}
		if (addr === ADDR_PLAYER_ID) {
			this.handlePlayerIdWrite(value)
			return
		}

		this.handlePlayerSpaceWrite(addr, value)
	}

	/**
	 * one-time-pad check: each attempt to change
	 * the live player increments the server's expected value by one, and only
	 * a matching authentication write lets the new id take over. A successful
	 * switch starts a fresh turn for the incoming player - the enforcement
	 * point for :709's unimplemented "one move per turn".
	 */
	private handlePlayerIdWrite(value: number) {
		this.authenticationValue += 1
		if (this.authenticationMirror !== this.authenticationValue) return
		this.playerId = value
		const mirror = this.mirrors[value]
		if (mirror) mirror.movedThisTurn = false
	}

	/**
	 * A write inside the tool's overall range but not one of the four
	 * administrative addresses. Only the currently live player's own slot is
	 * inspected for known offsets.
	 */
	private handlePlayerSpaceWrite(addr: number, value: number) {
		const liveBase = ADDR_BASE + this.playerId * MEM_PER_PLAYER
		if (addr < liveBase || addr >= liveBase + MEM_PER_PLAYER) {
			// Outside the live player's slot: the administrator may write anywhere
			//; anyone else is an illegal write (:726-739).
			if (this.playerId !== ADMINISTRATOR_ID) this.illegalWrites += 1
			return
		}

		const player = this.players[this.playerId]
		const mirror = this.mirrors[this.playerId]
		if (!player || !mirror) return // an authenticated id outside 0..NUM_PLAYERS-1: unreachable in practice, see header

		const offset = addr - liveBase
		if (offset === OFFSET_MOVE_TO_X) mirror.moveToX = value
		else if (offset === OFFSET_MOVE_TO_Y) mirror.moveToY = value
		else if (offset === OFFSET_MOVE_READY) { if (value !== 0) this.attemptMove(player, mirror) }
		else if (offset === OFFSET_PLAYER_COLOR) player.color = value
		else if (offset === OFFSET_TASK_COMPLETE) { if (value !== 0) this.attemptTaskComplete(player, mirror) }
		else if (offset >= OFFSET_TASK_ARRAY && offset < OFFSET_TASK_ARRAY + SIZE_OF_TASK * 4 && (offset - OFFSET_TASK_ARRAY) % 4 === 0) {
			mirror.taskArray[(offset - OFFSET_TASK_ARRAY) / 4] = value
		}
		// Any other in-range offset (including where-am-i, which is tool-owned):
		// "wrote to valid location" - no action.
	}

	/**, plus this port's :709 enforcement. */
	private attemptMove(player: PlayerState, mirror: PlayerMirror) {
		if (mirror.movedThisTurn) return // T5's implementation of :709
		if (player.energy <= 0) return
		if (mirror.moveToX < 0 || mirror.moveToX > GRAPHIC_WIDTH || mirror.moveToY < 0 || mirror.moveToY > GRAPHIC_HEIGHT) return
		const dx = player.x - mirror.moveToX
		const dy = player.y - mirror.moveToY
		if (Math.sqrt(dx * dx + dy * dy) > MAX_MOVE_DISTANCE) return

		player.x = mirror.moveToX
		player.y = mirror.moveToY
		player.energy -= ENERGY_PER_MOVE
		mirror.movedThisTurn = true

		for (let i = 0; i < NUM_LOCATIONS; i++) {
			const location = this.locations[i]
			if (location && player.x === location.x && player.y === location.y) player.visited[i] = true
		}
		if (!player.finished && player.visited.every(Boolean)) {
			player.finished = true
			player.finishedAtInstruction = this.instructionCount
		}
	}

	/**: award energy iff the task array is sorted ascending. */
	private attemptTaskComplete(player: PlayerState, mirror: PlayerMirror) {
		for (let i = 1; i < SIZE_OF_TASK; i++) {
			if (mirror.taskArray[i - 1] > mirror.taskArray[i]) return
		}
		player.energy = ENERGY_AWARD
		const random = mulberry32(0x1000 + player.id * SIZE_OF_TASK + this.instructionCount)
		mirror.taskArray = Array.from({ length: SIZE_OF_TASK }, () => Math.floor(random() * 0x7fffffff))
	}

	/**, minus the GUI-only "Reset" button call site. */
	private initializeGame() {
		this.gameOn = true
		this.authenticationValue = 0
		this.playerId = ADMINISTRATOR_ID
		this.players = Array.from({ length: NUM_PLAYERS }, (_, id) => this.freshPlayer(id))
		this.mirrors = Array.from({ length: NUM_PLAYERS }, () => this.freshMirror())

		const random = mulberry32(42) // cosmetic seed, matching MARS's `new Random(42)` in spirit only
		this.locations = []
		for (let i = 0; i < NUM_LOCATIONS - 1; i++) {
			this.locations.push({ x: Math.floor(random() * GRAPHIC_WIDTH), y: Math.floor(random() * (GRAPHIC_HEIGHT - 50)) })
		}
		this.locations.push({ x: START_AND_END_LOCATION, y: START_AND_END_LOCATION })

		for (const mirror of this.mirrors) {
			mirror.taskArray = Array.from({ length: SIZE_OF_TASK }, () => Math.floor(random() * 0x7fffffff))
		}
	}

	snapshot(): ScavengerHuntSnapshot {
		return {
			gameOn: this.gameOn,
			activePlayerId: this.playerId,
			numTurns: this.numTurns,
			locations: [...this.locations],
			players: this.players.map((player) => ({ ...player, visited: [...player.visited] })),
			illegalWrites: this.illegalWrites,
		}
	}
}
