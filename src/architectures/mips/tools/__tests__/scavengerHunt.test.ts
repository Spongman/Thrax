import { describe, expect, it } from 'vitest'
import { build, withExit } from '../../core/__tests__/helpers'
import {
	ADMINISTRATOR_ID,
	ENERGY_AWARD,
	GRAPHIC_HEIGHT,
	GRAPHIC_WIDTH,
	NUM_LOCATIONS,
	playerAddress,
	SCAVENGER_HUNT_ADDRESSES,
	ScavengerHunt,
	SIZE_OF_TASK,
	START_AND_END_LOCATION,
} from '../scavengerHunt'

const { authentication: ADDR_AUTH, playerId: ADDR_PLAYER_ID, gameOn: ADDR_GAME_ON, numTurns: ADDR_NUM_TURNS, offsets } = SCAVENGER_HUNT_ADDRESSES

/** A running one-time-pad counter, shared across every login attempt in a test - ScavengerHunt.java:547 increments it unconditionally. */
function makeAuth() {
	return { value: 0 }
}

function login(hunt: ScavengerHunt, id: number, auth: { value: number }) {
	auth.value += 1
	hunt.onMemoryWrite(ADDR_AUTH, 4, auth.value)
	hunt.onMemoryWrite(ADDR_PLAYER_ID, 4, id)
}

function gameOn(hunt: ScavengerHunt) {
	hunt.onMemoryWrite(ADDR_GAME_ON, 4, 1)
}

/** Tops up energy via a sorted (thus accepted) task array, while the player is still live. */
function topUpEnergy(hunt: ScavengerHunt, id: number) {
	const player = hunt.snapshot().players[id]
	if (player.energy > 1) return
	for (let i = 0; i < SIZE_OF_TASK; i++) hunt.onMemoryWrite(playerAddress(id, offsets.taskArray + i * 4), 4, i)
	hunt.onMemoryWrite(playerAddress(id, offsets.taskComplete), 4, 1)
}

/** One authenticated turn's move, topping up energy first so the walk never stalls. */
function moveOneTurn(hunt: ScavengerHunt, id: number, auth: { value: number }, toX: number, toY: number) {
	topUpEnergy(hunt, id)
	login(hunt, id, auth)
	hunt.onMemoryWrite(playerAddress(id, offsets.moveToX), 4, toX)
	hunt.onMemoryWrite(playerAddress(id, offsets.moveToY), 4, toY)
	hunt.onMemoryWrite(playerAddress(id, offsets.moveReady), 4, 1)
}

/** Walks one axis at a time in <=2-unit steps, always within MAX_MOVE_DISTANCE. */
function walkTo(hunt: ScavengerHunt, id: number, auth: { value: number }, target: { x: number; y: number }) {
	let { x, y } = hunt.snapshot().players[id]
	while (x !== target.x) {
		x += Math.sign(target.x - x) * Math.min(2, Math.abs(target.x - x))
		moveOneTurn(hunt, id, auth, x, y)
	}
	while (y !== target.y) {
		y += Math.sign(target.y - y) * Math.min(2, Math.abs(target.y - y))
		moveOneTurn(hunt, id, auth, x, y)
	}
}

describe('Scavenger Hunt', () => {
	it('starts with every player parked at the start/end location, not yet playing', () => {
		const hunt = new ScavengerHunt()
		const snapshot = hunt.snapshot()
		expect(snapshot.gameOn).toBe(false)
		expect(snapshot.activePlayerId).toBe(ADMINISTRATOR_ID)
		expect(snapshot.players[0]).toMatchObject({ x: START_AND_END_LOCATION, y: START_AND_END_LOCATION, energy: 20 })
	})

	it('initializes the game when the administrator writes GAME_ON', () => {
		const hunt = new ScavengerHunt()
		gameOn(hunt)
		const snapshot = hunt.snapshot()
		expect(snapshot.gameOn).toBe(true)
		expect(snapshot.locations).toHaveLength(NUM_LOCATIONS)
		// ScavengerHunt.java:944-946: the last location is always the start/end point.
		expect(snapshot.locations[NUM_LOCATIONS - 1]).toEqual({ x: START_AND_END_LOCATION, y: START_AND_END_LOCATION })
	})

	it('ignores GAME_ON once a player other than the administrator is live', () => {
		const hunt = new ScavengerHunt()
		const auth = makeAuth()
		login(hunt, 0, auth) // now player 0 is live, not the administrator
		gameOn(hunt)
		expect(hunt.snapshot().gameOn).toBe(false)
	})

	it('authenticates a player switch only with the matching one-time-pad value', () => {
		const hunt = new ScavengerHunt()
		hunt.onMemoryWrite(ADDR_AUTH, 4, 999) // wrong: server expects 1 on the first attempt
		hunt.onMemoryWrite(ADDR_PLAYER_ID, 4, 3)
		expect(hunt.snapshot().activePlayerId).toBe(ADMINISTRATOR_ID)

		hunt.onMemoryWrite(ADDR_AUTH, 4, 2) // the pad advanced to 2 after the failed attempt above
		hunt.onMemoryWrite(ADDR_PLAYER_ID, 4, 3)
		expect(hunt.snapshot().activePlayerId).toBe(3)
	})

	it('mirrors NUM_TURNS for anyone, with no effect on play', () => {
		const hunt = new ScavengerHunt()
		hunt.onMemoryWrite(ADDR_NUM_TURNS, 4, 5)
		expect(hunt.snapshot().numTurns).toBe(5)
	})

	it('moves a player toward their destination and deducts energy', () => {
		const hunt = new ScavengerHunt()
		gameOn(hunt)
		const auth = makeAuth()
		moveOneTurn(hunt, 0, auth, START_AND_END_LOCATION + 2, START_AND_END_LOCATION)
		const player = hunt.snapshot().players[0]
		expect(player.x).toBe(START_AND_END_LOCATION + 2)
		expect(player.energy).toBe(19)
	})

	it('rejects a move with no energy, out of bounds, or exceeding MAX_MOVE_DISTANCE', () => {
		const hunt = new ScavengerHunt()
		gameOn(hunt)
		const auth = makeAuth()

		// Out of bounds.
		login(hunt, 0, auth)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveToX), 4, -1)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveToY), 4, START_AND_END_LOCATION)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveReady), 4, 1)
		expect(hunt.snapshot().players[0].x).toBe(START_AND_END_LOCATION)

		// Too far: (3, 3) is sqrt(18) =~ 4.24, over MAX_MOVE_DISTANCE (2.5).
		login(hunt, 0, auth)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveToX), 4, START_AND_END_LOCATION + 3)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveToY), 4, START_AND_END_LOCATION + 3)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveReady), 4, 1)
		expect(hunt.snapshot().players[0].x).toBe(START_AND_END_LOCATION)

		// Drain energy to zero with 20 valid tiny moves (no top-up), then confirm a further move is blocked.
		for (let i = 0; i < 20; i++) {
			const target = i % 2 === 0 ? START_AND_END_LOCATION + 2 : START_AND_END_LOCATION
			login(hunt, 0, auth)
			hunt.onMemoryWrite(playerAddress(0, offsets.moveToX), 4, target)
			hunt.onMemoryWrite(playerAddress(0, offsets.moveToY), 4, START_AND_END_LOCATION)
			hunt.onMemoryWrite(playerAddress(0, offsets.moveReady), 4, 1)
		}
		expect(hunt.snapshot().players[0].energy).toBe(0)
		const stalledX = hunt.snapshot().players[0].x
		login(hunt, 0, auth)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveToX), 4, stalledX === START_AND_END_LOCATION ? START_AND_END_LOCATION + 2 : START_AND_END_LOCATION)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveToY), 4, START_AND_END_LOCATION)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveReady), 4, 1)
		expect(hunt.snapshot().players[0].x).toBe(stalledX) // no energy: unchanged
	})

	it('enforces one move per turn - ScavengerHunt.java:709\'s unimplemented TODO', () => {
		const hunt = new ScavengerHunt()
		gameOn(hunt)
		const auth = makeAuth()

		login(hunt, 0, auth)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveToX), 4, START_AND_END_LOCATION + 2)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveToY), 4, START_AND_END_LOCATION)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveReady), 4, 1)
		expect(hunt.snapshot().players[0].x).toBe(START_AND_END_LOCATION + 2)

		// Second move request in the same turn: silently ignored, no new login.
		hunt.onMemoryWrite(playerAddress(0, offsets.moveToX), 4, START_AND_END_LOCATION + 4)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveReady), 4, 1)
		expect(hunt.snapshot().players[0].x).toBe(START_AND_END_LOCATION + 2)
		expect(hunt.snapshot().players[0].energy).toBe(19) // no second deduction either

		// A fresh authenticated turn for the same player allows one more move.
		login(hunt, 0, auth)
		hunt.onMemoryWrite(playerAddress(0, offsets.moveReady), 4, 1) // moveToX is still 4 from above
		expect(hunt.snapshot().players[0].x).toBe(START_AND_END_LOCATION + 4)
	})

	it('tracks each location visited and finishes once every location is reached', () => {
		const hunt = new ScavengerHunt()
		gameOn(hunt)
		hunt.onInstruction(0, {} as never) // one tick of this port's instruction-count clock, see the header
		const auth = makeAuth()
		const locations = hunt.snapshot().locations

		walkTo(hunt, 0, auth, locations[0])
		let player = hunt.snapshot().players[0]
		expect(player.visited[0]).toBe(true)
		expect(player.visited.filter(Boolean)).toHaveLength(1)
		expect(player.finished).toBe(false)
		expect(player.finishedAtInstruction).toBeNull() // not finished yet

		for (let i = 1; i < NUM_LOCATIONS; i++) walkTo(hunt, 0, auth, locations[i])

		player = hunt.snapshot().players[0]
		expect(player.visited.every(Boolean)).toBe(true)
		expect(player.finished).toBe(true)
		expect(player.finishedAtInstruction).toBe(1) // stamped with the clock's value at that moment
	})

	it('awards energy for a correctly sorted task, and withholds it for an unsorted one', () => {
		const hunt = new ScavengerHunt()
		gameOn(hunt)
		const auth = makeAuth()
		moveOneTurn(hunt, 0, auth, START_AND_END_LOCATION + 2, START_AND_END_LOCATION) // energy 20 -> 19

		// Unsorted: no award.
		hunt.onMemoryWrite(playerAddress(0, offsets.taskArray + 0), 4, 5)
		hunt.onMemoryWrite(playerAddress(0, offsets.taskArray + 4), 4, 1)
		hunt.onMemoryWrite(playerAddress(0, offsets.taskComplete), 4, 1)
		expect(hunt.snapshot().players[0].energy).toBe(19)

		// Sorted ascending: awarded.
		for (let i = 0; i < SIZE_OF_TASK; i++) hunt.onMemoryWrite(playerAddress(0, offsets.taskArray + i * 4), 4, i)
		hunt.onMemoryWrite(playerAddress(0, offsets.taskComplete), 4, 1)
		expect(hunt.snapshot().players[0].energy).toBe(ENERGY_AWARD)
	})

	it('updates a player\'s color', () => {
		const hunt = new ScavengerHunt()
		gameOn(hunt)
		const auth = makeAuth()
		login(hunt, 0, auth)
		hunt.onMemoryWrite(playerAddress(0, offsets.playerColor), 4, 0xff0000)
		expect(hunt.snapshot().players[0].color).toBe(0xff0000)
	})

	it('counts a write into another player\'s slot as illegal, and leaves that player unaffected', () => {
		const hunt = new ScavengerHunt()
		gameOn(hunt)
		const auth = makeAuth()
		login(hunt, 0, auth) // player 0 is live
		hunt.onMemoryWrite(playerAddress(1, offsets.playerColor), 4, 0xff0000) // player 1's slot, not the live one

		expect(hunt.snapshot().illegalWrites).toBe(1)
		expect(hunt.snapshot().players[1].color).toBe(0)
	})

	it('lets the administrator write anywhere with no effect and no violation', () => {
		const hunt = new ScavengerHunt()
		hunt.onMemoryWrite(playerAddress(3, offsets.playerColor), 4, 0xff0000) // still ADMINISTRATOR_ID by default
		expect(hunt.snapshot().illegalWrites).toBe(0)
		expect(hunt.snapshot().players[3].color).toBe(0)
	})

	it('ignores an address entirely outside its MMIO range', () => {
		const hunt = new ScavengerHunt()
		hunt.onMemoryWrite(0x10010000, 4, 1) // ordinary data segment
		const snapshot = hunt.snapshot()
		expect(snapshot.gameOn).toBe(false)
		expect(snapshot.illegalWrites).toBe(0)
	})

	it('clears everything on reset', () => {
		const hunt = new ScavengerHunt()
		gameOn(hunt)
		const auth = makeAuth()
		moveOneTurn(hunt, 0, auth, START_AND_END_LOCATION + 2, START_AND_END_LOCATION)

		hunt.onReset()

		const snapshot = hunt.snapshot()
		expect(snapshot.gameOn).toBe(false)
		expect(snapshot.activePlayerId).toBe(ADMINISTRATOR_ID)
		expect(snapshot.locations).toHaveLength(0)
		expect(snapshot.players[0]).toMatchObject({ x: START_AND_END_LOCATION, y: START_AND_END_LOCATION, energy: 20 })
		expect(snapshot.illegalWrites).toBe(0)
	})


	it('starts the game from a program driving the real simulator', async () => {
		// ADDR_GAME_ON does not fit a signed 16-bit sw offset, so build it in a register.
		const simulator = build(withExit('li $t0, 1\nlui $t1, 0xffff\nori $t1, $t1, 0xe008\nsw $t0, 0($t1)'))
		const hunt = new ScavengerHunt()
		simulator.observers.push(hunt)
		await simulator.run()

		// The seam carries the written value, so the store reaches the game.
		expect(hunt.snapshot().gameOn).toBe(true)
	})

	it('sanity-checks the game stays within its declared graphic bounds', () => {
		const hunt = new ScavengerHunt()
		gameOn(hunt)
		for (const location of hunt.snapshot().locations) {
			expect(location.x).toBeGreaterThanOrEqual(0)
			expect(location.x).toBeLessThanOrEqual(GRAPHIC_WIDTH)
			expect(location.y).toBeGreaterThanOrEqual(0)
			expect(location.y).toBeLessThanOrEqual(GRAPHIC_HEIGHT)
		}
	})
})
