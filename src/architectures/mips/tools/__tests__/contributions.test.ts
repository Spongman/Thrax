import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '../../../../tools/registry'
import { createMipsTools } from '..'
import { manifest } from '../../manifest'

describe('MIPS tool contributions', () => {
	it('key one tool to each device panel and start idle', () => {
		const tools = new ToolRegistry([])
		for (const entry of createMipsTools()) tools.register(entry)
		const views = tools.views() as Record<string, { [field: string]: unknown }>
		expect(Object.keys(views).sort()).toEqual(['digitalLab', 'marsBot', 'scavengerHunt'])
		for (const key of Object.keys(views)) expect(manifest.panels).toContain(key)
		expect(views.marsBot.segments).toEqual([])
		expect(views.scavengerHunt.gameOn).toBe(false)
	})

	it('are dropped again by key', () => {
		const tools = new ToolRegistry([])
		for (const entry of createMipsTools()) tools.register(entry)
		expect(tools.unregister('marsBot')).toBe(true)
		expect(tools.has('marsBot')).toBe(false)
	})
})
