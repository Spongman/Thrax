import { describe, expect, it } from 'vitest'
import type { InstructionInfo } from '../../architectures/contracts'
import { describeWord as a32 } from '../../architectures/armv8/a32/instructions'
import { a64InstructionSet } from '../../architectures/armv8/a64/instructions'
import { mipsInstructionSet } from '../../architectures/mips/instructions'
import { decode as decodeMips } from '../../architectures/mips/core/decoder'
import { PipelineModel } from '../pipeline'
import { CacheSimulator } from '../cache'
import { ExecutionProfile } from '../profile'

describe('dependency resources', () => {
	it('retains all block-load destinations and base writeback', () => {
		// ldmia r4!, {r0,r1,r2}
		expect(a32(0xe8b40007).writes).toEqual([0, 1, 2, 4])
	})

	it('retains both A64 pair-load destinations, writeback and W/X aliasing', () => {
		// ldp x0,x1,[x2],#16
		expect(a64InstructionSet.describe(0xa8c10440).writes).toEqual([0, 1, 2])
		expect(a64InstructionSet.describe(0xa8c10440).loadWrites).toEqual([0, 1])
		// add w0,w1,#1; add x0,x1,#1
		expect(a64InstructionSet.describe(0x11000420).writes).toEqual([0])
		expect(a64InstructionSet.describe(0x91000420).writes).toEqual([0])
	})

	it.each([[3, 1], [4, 0]])('distinguishes a loaded result from ALU base writeback (%s)', (resource, stalls) => {
		const producer: InstructionInfo = { mnemonic: 'LOAD', category: 3, encoding: 0, reads: [], writes: [3, 4], loadWrites: [3], isLoad: true, isBranch: false, isJump: false }
		const consumer = { ...producer, mnemonic: 'USE', reads: [resource], writes: [], isLoad: false }
		const model = new PipelineModel({ dataHazards: 'forwarding', resolveBranchIn: 'ex', resolveJumpIn: 'id', prediction: 'none', windowSize: 64 })
		model.onConfigure({ delayedBranching: false, instructions: { ...mipsInstructionSet, describe: instruction => instruction as InstructionInfo } })
		model.onInstruction(0, producer, 0)
		model.onInstruction(4, consumer, 1)
		expect(model.snapshot().rows[1].stalls).toBe(stalls)
	})

	it('describes flag producers and consumers', () => {
		// cmp r0,#0; moveq r1,r2
		expect(a32(0xe3500000).writes).toContain(16)
		expect(a32(0x01a01002).reads).toContain(16)
		// cmp x0,#0; b.eq .
		expect(a64InstructionSet.describe(0xf100001f).writes).toEqual([32])
		expect(a64InstructionSet.describe(0x54000000).reads).toEqual([32])
	})

	it('retains MIPS HI/LO, overlapping FP lanes and condition dependencies', () => {
		// mult $t0,$t1; mflo $t2
		expect(mipsInstructionSet.describe(decodeMips(0x01090018)).writes).toEqual([64, 65])
		expect(mipsInstructionSet.describe(decodeMips(0x00005012)).reads).toEqual([65])
		// add.d $f0,$f2,$f4; bc1t .
		expect(mipsInstructionSet.describe(decodeMips(0x46241000))).toMatchObject({ reads: [34, 35, 36, 37], writes: [32, 33] })
		expect(mipsInstructionSet.describe(decodeMips(0x45010000)).reads).toEqual([66])
	})

	it.each([3, 32])('stalls on any written resource, including flags (%s)', resource => {
		const producer: InstructionInfo = { mnemonic: 'PAIR', category: 0, encoding: 0, reads: [], writes: [3, 32], isLoad: false, isBranch: false, isJump: false }
		const consumer = { ...producer, mnemonic: 'USE', reads: [resource], writes: [] }
		const model = new PipelineModel({ dataHazards: 'none', resolveBranchIn: 'ex', resolveJumpIn: 'id', prediction: 'none', windowSize: 64 })
		model.onConfigure({ delayedBranching: false, instructions: { ...mipsInstructionSet, describe: instruction => instruction as InstructionInfo } })
		model.onInstruction(0x1_0000_0000, producer, 0)
		model.onInstruction(0x1_0000_0004, consumer, 1)
		expect(model.snapshot().rows[1].stalls).toBe(3)
		expect(model.snapshot().rows[1].blockedOn).toBe(resource)
		expect(model.snapshot().rows[1].address).toBe(0x1_0000_0004)
	})

	it('keeps addresses separated above 32 bits in cache tags and execution counts', () => {
		const cache = new CacheSimulator({ blockCount: 1, blockSizeBytes: 4, associativity: 1, replacement: 'lru' })
		cache.onMemoryRead(4)
		cache.onMemoryRead(0x1_0000_0004)
		expect(cache.snapshot().hits).toBe(0)
		cache.onMemoryRead(0x1_0000_0004)
		expect(cache.snapshot().hits).toBe(1)
		const profile = new ExecutionProfile()
		profile.onInstruction(4)
		profile.onInstruction(0x1_0000_0004)
		expect([...profile.snapshot().byAddress.keys()]).toEqual([4, 0x1_0000_0004])
	})
})
