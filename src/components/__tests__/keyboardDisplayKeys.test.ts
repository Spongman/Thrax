import { describe, expect, it } from 'vitest'
import { keyToInput } from '../KeyboardDisplayTool'

const key = (name: string, modifiers: Partial<{ ctrlKey: boolean, metaKey: boolean, altKey: boolean }> = {}) =>
	keyToInput({ key: name, ctrlKey: false, metaKey: false, altKey: false, ...modifiers })

describe('keys typed into the MMIO keyboard', () => {
	it('hands printable keys and the control keys a program reads to the receiver', () => {
		expect(key('a')).toBe('a')
		expect(key(' ')).toBe(' ')
		expect(key('Enter')).toBe('\n')
		expect(key('Tab')).toBe('\t')
		expect(key('Backspace')).toBe('\b')
	})

	it('ignores shortcuts and keys that type nothing', () => {
		expect(key('c', { ctrlKey: true })).toBeNull()
		expect(key('ArrowLeft')).toBeNull()
		expect(key('Shift')).toBeNull()
		expect(key('F5')).toBeNull()
	})
})
