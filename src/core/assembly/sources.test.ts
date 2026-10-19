import { describe, expect, it } from 'vitest'
import { expandSources, type AssemblySource, type SourceExpansionPolicy } from './sources'

interface TestToken { text: string; file: string; unit: string }

// Deliberately uses a different grammar and token shape from MARS.
function policy(files: AssemblySource[], overrides: Partial<SourceExpansionPolicy<TestToken>> = {}): SourceExpansionPolicy<TestToken> {
	const documents = new Map(files.map((file) => [file.name, file]))
	return {
		identity: (file) => file.name,
		includeOnce: true,
		maxFileExpansions: files.length,
		tokenize: (file, root) => file.code.split('\n').filter(Boolean).map((text) => ({ text, file: file.name, unit: root.name })),
		readInclude: (tokens, index) => tokens[index].text.startsWith('@')
			? { name: tokens[index].text.slice(1), nextIndex: index + 1 } : null,
		resolve: (name) => {
			const file = documents.get(name)
			if (!file) throw new Error(`Missing ${name}`)
			return file
		},
		cycle: (_file, chain, token) => new Error(`${chain.join(' -> ')} in ${token.file}`),
		limit: (file) => new Error(`Expansion limit at ${file.name}`),
		boundary: () => [],
		...overrides,
	}
}

describe('shared source expansion', () => {
	const files = [
		{ name: 'main', code: '@left\n@right\nend' },
		{ name: 'left', code: '@common\nleft' },
		{ name: 'right', code: '@common\nright' },
		{ name: 'common', code: 'shared' },
	]

	it('retains source identity and root scope while splicing in source order', () => {
		expect(expandSources([files[0]], policy(files))).toEqual([
			{ text: 'shared', file: 'common', unit: 'main' },
			{ text: 'left', file: 'left', unit: 'main' },
			{ text: 'right', file: 'right', unit: 'main' },
			{ text: 'end', file: 'main', unit: 'main' },
		])
	})

	it('lets a dialect choose repeated includes and independent root scopes', () => {
		const tokens = expandSources([files[1], files[2]], policy(files, { includeOnce: false }))
		expect(tokens.filter((token) => token.text === 'shared').map((token) => token.unit)).toEqual(['left', 'right'])
	})

	it('bounds acyclic repeated expansion', () => {
		expect(() => expandSources([files[0]], policy(files, { includeOnce: false }))).toThrow('Expansion limit at common')
	})

	it('diagnoses cycles before include-once suppression', () => {
		const cyclic = [{ name: 'a', code: '@b' }, { name: 'b', code: '@a' }]
		expect(() => expandSources([cyclic[0]], policy(cyclic))).toThrow('a -> b -> a in b')
	})

	it('handles deep include chains without recursive calls or spread arguments', () => {
		const deep = Array.from({ length: 10000 }, (_, index) => ({
			name: String(index), code: index === 9999 ? 'last' : `@${index + 1}`,
		}))
		expect(expandSources([deep[0]], policy(deep))).toEqual([{ text: 'last', file: '9999', unit: '0' }])
	})

	it('rejects invalid budgets and nonadvancing include parsers', () => {
		expect(() => expandSources([], policy([], { maxFileExpansions: Infinity }))).toThrow(RangeError)
		expect(() => expandSources([files[0]], policy(files, {
			readInclude: () => ({ name: 'left', nextIndex: 0 }),
		}))).toThrow('Include parser must advance')
	})
})
