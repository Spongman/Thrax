import { describe, expect, it } from 'vitest'
import { summariseGist } from '../github'
import { gitHubHeaders } from '../remote'

describe('a gist in the list', () => {
	it('is summarised by what it holds and whether any of it assembles', () => {
		const summary = summariseGist({
			id: 'abc',
			description: null,
			files: { 'main.asm': { filename: 'main.asm' }, 'notes.md': { filename: 'notes.md' } },
			public: false,
			updated_at: '2026-09-01T10:00:00Z',
			html_url: 'https://gist.github.com/me/abc',
		})
		expect(summary).toEqual({
			id: 'abc',
			description: '',
			files: ['main.asm', 'notes.md'],
			hasSource: true,
			public: false,
			updatedAt: '2026-09-01T10:00:00Z',
			url: 'https://gist.github.com/me/abc',
		})
	})

	it('knows a gist with nothing to assemble', () => {
		expect(summariseGist({ id: 'x', description: 'notes', files: { 'a.md': { filename: 'a.md' } }, public: true, updated_at: '', html_url: '' }).hasSource).toBe(false)
	})
})

describe('GitHub request headers', () => {
	it('sign a request only when there is a token', () => {
		expect(gitHubHeaders(null)).toEqual({ Accept: 'application/vnd.github+json' })
		expect(gitHubHeaders('tok')).toEqual({ Accept: 'application/vnd.github+json', Authorization: 'Bearer tok' })
	})
})
