import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { resizeFrame } from '../Modal'

/**
 * A resizable dialog is only as narrow as what it holds will go.  The GitHub
 * dialog pinned a width floor on its body rather than on the dialog, so taking
 * the corner in past that floor left the body wider than the dialog and its
 * token row was drawn outside the border.  A dialog's opening size belongs to
 * the dialog itself, where the resize can override it.
 */

const directory = join(__dirname, '..')
const sheets = readdirSync(directory).filter((name) => name.endsWith('.css'))
const read = (name: string) => readFileSync(join(directory, name), 'utf8')

/** Every `selector { … }` rule in a stylesheet, comments stripped. */
function rules(css: string) {
	return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.map((match) => ({ selector: match[1].trim(), body: match[2] }))
}

const minWidthOf = (body: string) => Number(/(?:^|[;\s])min-width:\s*(\d+)px/.exec(body)?.[1] ?? 0)

describe('dialog layout', () => {
	const floor = minWidthOf(rules(read('Modal.css')).find((rule) => rule.selector === '.modal')?.body ?? '')

	it('gives the dialog a floor to resize down to', () => {
		expect(floor).toBeGreaterThan(0)
	})

	// A gesture that stops short of the stylesheet's floor leaves the corner
	// behind the pointer, since the element cannot follow it any further in.
	it('stops the resize at the floor the stylesheet keeps', () => {
		expect(resizeFrame({ left: 0, top: 0, width: 400, height: 300 }, -1000, -1000).width).toBe(floor)
	})

	it('lets every dialog body shrink to that floor', () => {
		const pinned = sheets.flatMap((name) => rules(read(name))
			.filter((rule) => rule.selector.includes('.modal-body') && minWidthOf(rule.body) > floor)
			.map((rule) => `${name}: ${rule.selector}`))
		expect(pinned).toEqual([])
	})
})
