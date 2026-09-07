import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EXAMPLES } from '../../examples'
import { PANELS } from '../panels'
import * as icons from '../icons'
import type { Icon } from '../icons'

/**
 * The icons are drawn by hand on a 16-unit grid, and a mistyped coordinate
 * puts a stroke outside the viewBox, where it is quietly clipped away rather
 * than reported.  These read every path back and check it lands on the grid,
 * which is the one thing about a hand-drawn glyph a machine can tell.
 */

const GRID = 16
/** A stroke sits half its width outside the shape, so the edge has a little room. */
const SLACK = 2

/** Every runtime export of the module is one icon; the rest is types. */
const drawn: Array<[string, Icon]> = Object.entries(icons)

/** How many numbers each path command takes, by its letter. */
const ARGUMENTS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }

interface Command {
	letter: string
	numbers: number[]
}

/** Splits path data into its commands, or throws saying which one is malformed. */
export function parsePath(data: string): Command[] {
	const tokens = data.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? []
	const commands: Command[] = []
	let letter = ''
	for (let at = 0; at < tokens.length;) {
		if (/[A-Za-z]/.test(tokens[at])) letter = tokens[at++]
		if (letter === '') throw new Error(`path starts with ${tokens[at]}, not a command`)
		const wanted = ARGUMENTS[letter.toLowerCase()]
		if (wanted === undefined) throw new Error(`unknown command ${letter}`)
		const numbers = tokens.slice(at, at + wanted).map(Number)
		if (numbers.length < wanted) throw new Error(`${letter} wants ${wanted} numbers, given ${numbers.length}`)
		commands.push({ letter, numbers })
		at += wanted
	}
	return commands
}

describe('icons', () => {
	it('reads a path back as the commands it is written from', () => {
		expect(parsePath('M1 2 L3.5 4 Z')).toEqual([
			{ letter: 'M', numbers: [1, 2] },
			{ letter: 'L', numbers: [3.5, 4] },
			{ letter: 'Z', numbers: [] },
		])
		expect(() => parsePath('M1 2 L3')).toThrow(/wants 2/)
		expect(() => parsePath('M1 2 K3 4')).toThrow(/unknown command/)
	})

	it.each(drawn)('%s draws inside the grid', (_name, icon) => {
		const markup = renderToStaticMarkup(icon())
		expect(markup).toContain('viewBox="0 0 16 16"')

		const commands = [...markup.matchAll(/ d="([^"]+)"/g)].flatMap((match) => parsePath(match[1]))
		// A rect or a circle is placed by its own attributes rather than a path.
		const placed = [...markup.matchAll(/ (?:x|y|cx|cy)="([\d.]+)"/g)].map((match) => Number(match[1]))
		expect(commands.length + placed.length).toBeGreaterThan(0)

		for (const number of placed) {
			expect(number).toBeGreaterThanOrEqual(-SLACK)
			expect(number).toBeLessThanOrEqual(GRID + SLACK)
		}
		for (const { letter, numbers } of commands) {
			// A lowercase command steps by a distance rather than naming a place,
			// so it is the size of the step that has to fit on the grid.
			const relative = letter !== letter.toUpperCase()
			for (const number of numbers) {
				expect(number, `${letter} ${numbers.join(' ')}`).toBeGreaterThanOrEqual(relative ? -GRID : -SLACK)
				expect(number, `${letter} ${numbers.join(' ')}`).toBeLessThanOrEqual(GRID + SLACK)
			}
		}
	})

	it('gives every panel and every example one', () => {
		for (const panel of PANELS) expect(typeof panel.icon, panel.id).toBe('function')
		for (const [key, example] of Object.entries(EXAMPLES)) expect(typeof example.icon, key).toBe('function')
	})
})
