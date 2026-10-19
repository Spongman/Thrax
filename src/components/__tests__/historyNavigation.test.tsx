import { describe, expect, it } from 'vitest'
import { Kind } from '../../core/effectKind'
import { renderToStaticMarkup } from 'react-dom/server'
import HistoryView from '../HistoryView'
import { historyFormatter } from '../../architectures/mips/history/format'
import type { EffectStore } from '../../architectures/mips/core/effectStore'
import type { MipsHistory } from '../../architectures/mips/core/history'
import { historyWith } from '../../architectures/mips/core/__tests__/historyFixture'

/**
 * A history row is the way into every other panel: the address and the source
 * go to the editor, a memory chip to the memory view, and a register chip back
 * to the moment the value was written.  What is asserted here is that each of
 * those is something to click, since a row that only prints is the regression
 * worth catching.
 */

const draw = (entries: MipsHistory, effects: EffectStore, cursor: number, sourceOf: () => { file: string, line: number } | null) =>
	renderToStaticMarkup(
		<HistoryView
			entries={entries}
			format={historyFormatter(effects)}
			cursor={cursor}
			version={1}
			sourceOf={sourceOf}
			selectedId={null}
			onSelect={() => {}}
			onSetNow={() => {}}
			onSelectAddress={() => {}}
			onSelectSource={() => {}}
			onSelectRegister={() => {}}
			onHoverAddress={() => {}}
			hoveredAddress={null}
			onHoverRegister={() => {}}
			hoveredRegister={null}
		/>
	)

const render = (
	push: (store: EffectStore) => void,
	sourceOf: () => { file: string, line: number } | null = () => ({ file: 'main.asm', line: 7 }),
	cursor = 1,
) => {
	const history = historyWith(0x00400000, push)
	return draw(history, history.effects, cursor, sourceOf)
}

describe('a history row', () => {
	it('offers its address and its source line as somewhere to go', () => {
		const markup = render((store) => store.push(Kind.REGISTER, 8, 5))
		expect(markup).toContain('Go to main.asm:7')
		expect(markup).toContain('main.asm:7')
	})

	it('offers nothing where the address has no source line', () => {
		// A word the program wrote itself has no line, so the cell reads as text.
		const markup = render((store) => store.push(Kind.REGISTER, 8, 5), () => null)
		expect(markup).toContain('disabled')
		expect(markup).toContain('No source line for this address')
	})

	it('sends a register chip back to the moment its value was written', () => {
		const markup = render((store) => store.push(Kind.REGISTER, 8, 5))
		expect(markup).toContain('Run to here and go to $t0')
	})

	it('sends a memory chip to the memory view', () => {
		const markup = render((store) => store.push(Kind.MEMORY, 0x10010000 >>> 2, 0, [7]))
		expect(markup).toContain('Run to here and show 0x10010000 in memory')
	})

	it('runs to the entry from an effect that names nowhere to go', () => {
		// Everything from the disassembly rightwards puts the machine here, so a
		// chip is worth clicking even when it has no panel to send anyone to.
		const markup = render((store) => store.push(Kind.CONSOLE, 0, 0, 'hi'))
		expect(markup).toContain('history-chip-inert')
		expect(markup).toContain('run to here')
		expect(markup).not.toContain('disabled')
	})

	it('runs to the entry from the disassembly and the space beyond it', () => {
		// Both the disassembly column and the effects strip carry the same offer,
		// so the whole right-hand half of the row is one target.  Which way it
		// runs depends on the side of the present the entry is on.
		const behind = render((store) => store.push(Kind.REGISTER, 8, 5), undefined, 1)
		expect(behind.match(/Step back to here/g)?.length).toBe(2)

		const ahead = render((store) => store.push(Kind.REGISTER, 8, 5), undefined, 0)
		expect(ahead.match(/Run forward to here/g)?.length).toBe(2)
	})
})

describe('how a history row spells a number', () => {
	it('dims an address the way every other panel dims one', () => {
		// The address column used to print a bare string, so the workspace's
		// leading-zero setting never reached it.
		const markup = render((store) => store.push(Kind.REGISTER, 8, 5))
		expect(markup).toContain('history-address')
		expect(markup).toContain('hex-zero')
	})

	it('keeps a value in one element, so a flex gap cannot split it', () => {
		// The chip is a flex row: without a wrapper each part of a rendered word
		// became an item of its own and `0x` stood apart from its digits.
		const markup = render((store) => store.push(Kind.REGISTER, 8, 5))
		const value = /<span class="history-chip-value">(.*?)<\/span>/.exec(markup)
		expect(value).not.toBeNull()
		expect(value![1]).toContain('0x')
		expect(value![1]).toContain('hex-zero')
	})
})

describe('the instruction about to run', () => {
	it('is marked where the cursor sits, and nowhere else', () => {
		// Everything before the cursor has happened; the entry it sits on has not.
		expect(render((store) => store.push(Kind.REGISTER, 8, 5), undefined, 0)).toContain('history-next active')
		expect(render((store) => store.push(Kind.REGISTER, 8, 5), undefined, 1)).not.toContain('history-next active')
	})
})

describe('the scroller that sizes the window of rows', () => {
	it('is there before the first instruction is', () => {
		// Only the rows on screen are built, and how many that is comes from
		// measuring this element.  While it was mounted alongside the first entry
		// rather than with the panel, nothing measured it: the height stayed at
		// nothing and the rows filled only the top of however tall the panel was.
		const empty = historyWith(0)
		empty.truncate(0)
		const markup = draw(empty, empty.effects, 0, () => null)
		expect(markup).toContain('history-scroll')
		expect(markup).toContain('Step or run a program')
	})
})
