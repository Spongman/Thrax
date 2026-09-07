import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { stripCommonFolder, unzipWorkspace, zipWorkspace } from '../archive'
import { gistBody } from '../github'
import { gistApiUrl, gitHubContentsUrl, parseGitHubUrl, rawGitHubUrl } from '../remote'
import { decodeWorkspace, encodeWorkspace, shareLink, workspaceFromFragment } from '../share'
import { fromWorkspaceDocument, toWorkspaceDocument, workspaceFromFiles, type WorkspaceSnapshot } from '../workspace'

const WORKSPACE: WorkspaceSnapshot = {
	files: [
		{ title: 'main.asm', code: 'main:\n\tjal helper\n\tli $v0, 10\n\tsyscall\n' },
		{ title: 'lib.asm', code: 'helper:\n\tjr $ra\n' },
	],
	active: 'lib.asm',
	assembleAll: true,
}

describe('the workspace document', () => {
	it('reads back what it wrote, without the ids a session makes up', () => {
		const written = JSON.parse(JSON.stringify(toWorkspaceDocument(WORKSPACE)))
		expect(fromWorkspaceDocument(written)).toEqual(WORKSPACE)
	})

	it('refuses anything that is not a workspace', () => {
		expect(fromWorkspaceDocument(null)).toBeNull()
		expect(fromWorkspaceDocument({ format: 'thrax-workspace', files: [] })).toBeNull()
		expect(fromWorkspaceDocument({ format: 'other', files: WORKSPACE.files })).toBeNull()
		expect(fromWorkspaceDocument({ format: 'thrax-workspace', files: [{ title: 1, code: '' }] })).toBeNull()
	})

	it('forgets an active file the workspace does not hold', () => {
		const document = { ...toWorkspaceDocument(WORKSPACE), active: 'gone.asm' }
		expect(fromWorkspaceDocument(document)?.active).toBeUndefined()
	})

	it('keeps the sources out of a pile of files, and lets a manifest speak for them', () => {
		const loose = workspaceFromFiles([{ title: 'a.asm', code: '' }, { title: 'notes.txt', code: 'x' }, { title: 'b.s', code: '' }])
		expect(loose?.files.map((file) => file.title)).toEqual(['a.asm', 'b.s'])
		expect(loose?.assembleAll).toBe(true)

		const manifest = { title: 'thrax-workspace.json', code: JSON.stringify(toWorkspaceDocument(WORKSPACE)) }
		expect(workspaceFromFiles([manifest, ...WORKSPACE.files])).toEqual(WORKSPACE)
	})

	it('opens other text file by file when there is no source among them', () => {
		expect(workspaceFromFiles([{ title: 'readme.txt', code: 'hi' }])?.files).toEqual([{ title: 'readme.txt', code: 'hi' }])
		expect(workspaceFromFiles([])).toBeNull()
	})
})

describe('the zip archive', () => {
	it('round-trips a workspace', () => {
		expect(unzipWorkspace(zipWorkspace(WORKSPACE))).toEqual(WORKSPACE)
	})

	it('opens an archive made elsewhere, with a folder around everything', () => {
		const foreign = zipSync({
			'project/main.asm': strToU8('main:\n'),
			'project/lib.asm': strToU8('lib:\n'),
			'project/notes.txt': strToU8('ignored'),
			'__MACOSX/project/._main.asm': strToU8('junk'),
		})
		expect(unzipWorkspace(foreign)).toEqual({
			files: [{ title: 'main.asm', code: 'main:\n' }, { title: 'lib.asm', code: 'lib:\n' }],
			assembleAll: true,
		})
	})

	it('strips only a folder every entry shares', () => {
		expect(stripCommonFolder(['a/b/x.asm', 'a/b/y.asm'])).toEqual(['x.asm', 'y.asm'])
		expect(stripCommonFolder(['a/x.asm', 'b/y.asm'])).toEqual(['a/x.asm', 'b/y.asm'])
		expect(stripCommonFolder(['a/x.asm', 'y.asm'])).toEqual(['a/x.asm', 'y.asm'])
	})
})

describe('the share link', () => {
	it('carries the whole workspace in the fragment', () => {
		const link = shareLink(WORKSPACE, { origin: 'https://example.test', pathname: '/Thrax/' })
		expect(link.startsWith('https://example.test/Thrax/#ws=')).toBe(true)
		expect(workspaceFromFragment(new URL(link).hash)).toEqual(WORKSPACE)
	})

	it('reads the same for the same workspace', () => {
		expect(encodeWorkspace(WORKSPACE)).toBe(encodeWorkspace(WORKSPACE))
	})

	it('answers null to a fragment that is not a workspace', () => {
		expect(workspaceFromFragment('')).toBeNull()
		expect(workspaceFromFragment('#other=1')).toBeNull()
		expect(decodeWorkspace('not-base64!')).toBeNull()
		expect(decodeWorkspace('AAAA')).toBeNull()
	})
})

describe('GitHub links', () => {
	it('names a gist, a file or a folder', () => {
		expect(parseGitHubUrl('https://gist.github.com/someone/abc123')).toEqual({ kind: 'gist', id: 'abc123' })
		expect(parseGitHubUrl('https://gist.github.com/abc123')).toEqual({ kind: 'gist', id: 'abc123' })
		expect(parseGitHubUrl('https://github.com/o/r/blob/main/src/a.asm')).toEqual({ kind: 'blob', owner: 'o', repo: 'r', ref: 'main', path: 'src/a.asm' })
		expect(parseGitHubUrl('https://github.com/o/r/tree/dev/examples')).toEqual({ kind: 'tree', owner: 'o', repo: 'r', ref: 'dev', path: 'examples' })
		expect(parseGitHubUrl('https://github.com/o/r')).toEqual({ kind: 'tree', owner: 'o', repo: 'r', ref: 'HEAD', path: '' })
	})

	it('leaves other links alone', () => {
		expect(parseGitHubUrl('https://example.test/a.asm')).toBeNull()
		expect(parseGitHubUrl('https://github.com/o/r/pulls/3')).toBeNull()
		expect(parseGitHubUrl('not a url')).toBeNull()
	})

	it('turns each into the address that answers a browser', () => {
		expect(rawGitHubUrl({ kind: 'blob', owner: 'o', repo: 'r', ref: 'main', path: 'src/a.asm' })).toBe('https://raw.githubusercontent.com/o/r/main/src/a.asm')
		expect(gitHubContentsUrl({ kind: 'tree', owner: 'o', repo: 'r', ref: 'dev', path: 'examples' })).toBe('https://api.github.com/repos/o/r/contents/examples?ref=dev')
		expect(gitHubContentsUrl({ kind: 'tree', owner: 'o', repo: 'r', ref: 'HEAD', path: '' })).toBe('https://api.github.com/repos/o/r/contents/')
		expect(gistApiUrl('abc')).toBe('https://api.github.com/gists/abc')
	})

	it('writes a gist a file at a time, none of them empty or nested', () => {
		const body = gistBody({ files: [{ title: 'lib/x.asm', code: '' }, { title: 'main.asm', code: 'main:\n' }], assembleAll: false }, 'test')
		expect(body.public).toBe(false)
		expect(body.files).toEqual({ 'lib__x.asm': { content: '\n' }, 'main.asm': { content: 'main:\n' } })
	})
})
