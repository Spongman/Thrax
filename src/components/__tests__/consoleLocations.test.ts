import { describe, expect, it } from 'vitest'
import { AssemblyError, formatDiagnostic } from '../../core/diagnostics'
import { splitLocations } from '../consoleLocations'

describe('a diagnostic printed the way gcc prints one', () => {
	it('leads with the position and says it once', () => {
		const error = new AssemblyError('Unexpected token "1684"', { file: 'game.asm', line: 87, column: 12 })
		expect(error.message).toBe('Unexpected token "1684" at game.asm:87:12')
		expect(formatDiagnostic(error.diagnostic)).toBe('game.asm:87:12: error: Unexpected token "1684"')
	})

	it('manages without a column, a file, or a position', () => {
		expect(formatDiagnostic(new AssemblyError('Bad', { file: 'a.asm', line: 3 }).diagnostic)).toBe('a.asm:3: error: Bad')
		expect(formatDiagnostic(new AssemblyError('Bad', { line: 3, column: 1 }).diagnostic)).toBe('source:3:1: error: Bad')
		expect(formatDiagnostic({ severity: 'error', message: 'Broken' })).toBe('error: Broken')
		expect(formatDiagnostic({ severity: 'warning', message: 'Odd', file: 'a.asm', line: 1, column: 1 })).toBe('a.asm:1:1: warning: Odd')
	})
})

describe('locations in console output', () => {
	it('picks out the position at the start of an error line', () => {
		const parts = splitLocations('game.asm:87:12: error: Unexpected token "1684"\nlib.asm:3: error: Bad\n')
		expect(parts).toEqual([
			{ kind: 'location', text: 'game.asm:87:12:', location: { file: 'game.asm', line: 87, column: 12 } },
			{ kind: 'text', text: ' error: Unexpected token "1684"\n' },
			{ kind: 'location', text: 'lib.asm:3:', location: { file: 'lib.asm', line: 3, column: undefined } },
			{ kind: 'text', text: ' error: Bad\n' },
		])
	})

	it('leaves program output alone', () => {
		expect(splitLocations('Sum: 12:30 today\nhttp://x:1: no')).toEqual([{ kind: 'text', text: 'Sum: 12:30 today\nhttp://x:1: no' }])
		expect(splitLocations('')).toEqual([])
	})
})
