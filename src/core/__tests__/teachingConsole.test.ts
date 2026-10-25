import { expect, it, vi } from 'vitest'
import { TeachingConsole, recordIntegerInput } from '../environments/teachingConsole'

it('uses explicit native service numbers and separate integer/string arguments', () => {
	const output: string[] = [], halt = vi.fn(), read = vi.fn((address: number) => [65, 66, 0][address - 100])
	const console = new TeachingConsole({ integer: 3, character: 6, string: 14, exit: [9] }, {
		argument: string => string ? 100 : -1, write: text => output.push(text), read, stringLimit: () => 3, halt,
	})
	for (const service of [3, 6, 14, 9]) expect(console.dispatch(service)).toBe(true)
		expect(output).toEqual(['-1', '\u00ff', 'AB'])
		expect(halt).toHaveBeenCalledOnce()
		expect(read.mock.calls.map(([address]) => address)).toEqual([100, 101, 102])
		expect(console.dispatch(10)).toBe(false)
})

it('captures only accepted input, in begin/write/close order', () => {
	const events: string[] = []
	const instruction = { begin: () => { events.push('begin') }, accept: (value: number) => { events.push(String(value)) }, close: () => { events.push('close') } }
	for (const text of ['12x', '2147483648', '']) expect(recordIntegerInput(text, 32, instruction)).toBe(false)
		expect(events).toEqual([])
		expect(recordIntegerInput('-2147483648', 32, instruction)).toBe(true)
		expect(events).toEqual(['begin', '-2147483648', 'close'])
})
