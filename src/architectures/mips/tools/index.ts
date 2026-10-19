import type { ToolContribution } from '../../contracts'
import { DigitalLabSim } from './digitalLab'
import { MarsBot } from './marsBot'
import { ScavengerHunt } from './scavengerHunt'

/** The MARS device tools, fresh per activation. */
export function createMipsTools(): readonly ToolContribution[] {
	return [
		{ key: 'marsBot', tool: new MarsBot() },
		{ key: 'digitalLab', tool: new DigitalLabSim() },
		{ key: 'scavengerHunt', tool: new ScavengerHunt() },
	]
}
