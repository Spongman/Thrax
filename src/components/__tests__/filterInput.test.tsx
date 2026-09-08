import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import FilterInput from '../FilterInput'

/** The clear button is joined to the box, and offers itself only when it would do something. */
describe('a filter box', () => {
	it('offers nothing to clear while it is empty', () => {
		const markup = renderToStaticMarkup(<FilterInput value="" onChange={() => {}} />)
		expect(markup).toContain('class="filter-clear"')
		expect(markup).toContain('disabled=""')
	})

	it('offers to clear what was typed', () => {
		const markup = renderToStaticMarkup(<FilterInput value="loop" onChange={() => {}} />)
		expect(markup).toContain('value="loop"')
		expect(markup).not.toContain('disabled')
	})
})
