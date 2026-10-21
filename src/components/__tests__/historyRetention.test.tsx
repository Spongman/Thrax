import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { HistoryRetentionStatus } from '../HistoryRetentionStatus'

it('shows the shared retention budget, evictions and payload accounting', () => {
	const html = renderToStaticMarkup(<HistoryRetentionStatus retention={{ entries: 3000, entryLimit: 1000000, liveBufferBytes: 1048576, allocatedBufferBytes: 2097152, byteLimit: 268435456, payloadCount: 4, entryEvictions: 2, byteEvictions: 1, oversizedEntries: 0, lastEviction: 'byte-limit' }} />)
	expect(html).toContain('3,000')
	expect(html).toContain('1.0 MiB')
	expect(html).toContain('2.0 MiB')
	expect(html).toContain('256.0 MiB')
	expect(html).toContain('memory limit reached')
	expect(html).toContain('whole blocks retained')
	expect(html).toContain('heap memory is additional')
	expect(renderToStaticMarkup(<HistoryRetentionStatus />)).toBe('')
})
