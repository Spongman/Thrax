import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EditableCell from '../EditableCell'
import MemoryView from '../MemoryView'

/**
 * The pointer finds a cell by `data-address`, so a cell drawn without one is
 * there to look at and nothing else: no tooltip, and no line lit in the editor.
 * Rendered to markup rather than driven, since the attributes are the whole of
 * what the hover depends on.
 */

describe('a hoverable cell', () => {
	it('publishes what it covers, so the pointer can find it', () => {
		const markup = renderToStaticMarkup(
			<EditableCell text="0000002a" editable={false} address={0x10010000} size={4} onCommit={() => true}>
				0000002a
			</EditableCell>
		)
		expect(markup).toContain(`data-address="${0x10010000}"`)
		expect(markup).toContain('data-size="4"')
	})

	it('still publishes them while it can be edited', () => {
		const markup = renderToStaticMarkup(
			<EditableCell text="0000002a" editable address={0x10010004} size={4} onCommit={() => true}>
				0000002a
			</EditableCell>
		)
		expect(markup).toContain(`data-address="${0x10010004}"`)
	})
})

describe('the memory view', () => {
	const render = (editable: boolean) => renderToStaticMarkup(
		<MemoryView
			memory={{ words: new Map([[0x10010000 >>> 2, 42]]) }}
			pc={null}
			returnAddresses={new Set()}
			focusAddress={null}
			onHoverAddress={() => {}}
			editable={editable}
			onEditByte={() => true}
		/>
	)

	it('makes every word cell hoverable, not only the ascii column', () => {
		// A word is the only cell the editor can be told about: the source line is
		// lit for a four-byte group, so losing it loses the cross-highlight too.
		for (const editable of [false, true]) {
			const markup = render(editable)
			expect(markup, `editable=${editable}`).toContain('data-size="4"')
			expect(markup, `editable=${editable}`).toContain('data-size="1"')
		}
	})
})
