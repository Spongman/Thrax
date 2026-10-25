import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InstructionSet, PipelineModel as ArchitecturePipeline } from '../../architectures/contracts'
import { DEFAULT_PIPELINE_SETTINGS, PipelineModel } from '../../tools/pipeline'
import PipelineView from '../PipelineView'

function longOperation(executeCycles: number) {
	const pipeline: ArchitecturePipeline = {
		stages: [{ label: 'F', name: 'Fetch', kind: 'if' }, { label: 'D', name: 'Decode', kind: 'id' }, { label: 'E', name: 'Execute', kind: 'ex' }],
		readStage: 1, writeStage: 2, delaySlots: 0,
		hazards: [{ value: 'forwarding', label: 'Execute', useStage: 2, writeThenRead: false, bypasses: [] }],
		branches: [{ value: 'ex', label: 'Execute', stage: 2 }],
		jumps: [{ value: 'ex', label: 'Execute', stage: 2 }],
		stageCycles: (_instruction, stage) => stage === 2 ? executeCycles : 1,
	}
	const instructions: InstructionSet = {
		pipeline, encodings: ['Operation'], registerNames: [], decodeExecuted: () => null,
		describe: () => ({ mnemonic: 'LONG', category: 0, encoding: 0, reads: [], writes: [], isLoad: false, isJump: false, isBranch: false }),
	}
	const model = new PipelineModel()
	model.onConfigure({ delayedBranching: false, instructions })
	model.onInstruction(0x1000, 0, 0)
	return model.snapshot()
}

it('renders every active cycle of a long final stage through the shared view', () => {
	const pipeline = longOperation(4)
	const markup = renderToStaticMarkup(<PipelineView pipeline={pipeline} settings={DEFAULT_PIPELINE_SETTINGS} onChange={() => {}} />)
	expect(markup.match(/<td class="pipeline-stage pipeline-ex(?: picked)?">E<\/td>/g)).toHaveLength(4)
	expect(markup).toContain('Cycle 6 (latest)')
	expect(markup).toContain('Multi-cycle execution')
	expect(markup).not.toContain('pipeline-stage pipeline-stall')
})

it('bounds timeline rendering while retaining the full duration of a very long wait', () => {
	const pipeline = longOperation(100_000)
	const markup = renderToStaticMarkup(<PipelineView pipeline={pipeline} settings={DEFAULT_PIPELINE_SETTINGS} onChange={() => {}} />)
	expect(pipeline.cycles).toBe(100_002)
	expect(markup.match(/<th class="pipeline-cycle(?: picked)?"/g)).toHaveLength(256)
	expect(markup.match(/<td class="pipeline-stage pipeline-ex(?: picked)?">E<\/td>/g)).toHaveLength(256)
	expect(markup).toContain('Earlier cycles')
	expect(markup).toContain('Later cycles')
	expect(markup).toContain('Cycle 100002 (latest)')
})

it('explains absent timing without showing a previous CPU model or controls', () => {
	const model = new PipelineModel()
	model.onConfigure({ delayedBranching: false })
	const markup = renderToStaticMarkup(<PipelineView pipeline={model.snapshot()} settings={DEFAULT_PIPELINE_SETTINGS} onChange={() => {}} />)
	expect(markup).toContain('No pipeline timing model is supplied for this CPU model.')
	expect(markup).not.toContain('<select')
})
