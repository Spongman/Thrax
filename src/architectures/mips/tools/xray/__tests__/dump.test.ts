import { describe, it } from 'vitest'
import { writeFileSync } from 'node:fs'
import { geometryOf } from '../geometry'
import { XRAY_DATAPATHS, XRAY_PALETTE } from '../datapaths'
import type { XrayDiagram } from '../datapaths'
import { nightColor } from '../animation'

describe('dump', () => {
	it.skipIf(!process.env.XRAY_DUMP)('writes geometry', () => {
		const out: Record<string, unknown> = {}
		for (const key of Object.keys(XRAY_DATAPATHS) as XrayDiagram[]) {
			const g = geometryOf(key)
			const dp = XRAY_DATAPATHS[key]
			const colors: Record<number, string> = {}
			for (const v of dp.vertices) {
				const i = v.colors.itype
				colors[v.index] = nightColor(i === undefined ? '#009900' : XRAY_PALETTE[i])
			}
			out[key] = {
				width: dp.width, height: dp.height,
				wires: g.wires.map((w) => ({ ...w, color: colors[w.index] })),
				junctions: g.junctions,
				arrows: g.arrows,
				blocks: g.blocks,
				vertices: dp.vertices.map((v) => ({ index: v.index, name: v.name, init: v.init, end: v.end, otherAxis: v.otherAxis, movingXaxis: v.movingXaxis, targets: v.targets, isText: v.isText })),
			}
		}
		writeFileSync(process.env.XRAY_DUMP!, JSON.stringify(out))
	})
})
