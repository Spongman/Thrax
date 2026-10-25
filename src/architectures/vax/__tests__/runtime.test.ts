import { afterEach, describe, expect, it } from 'vitest'
import definition from '../index'
import { variantOf, type ArchitectureServices, type Machine } from '../../contracts'
import type { TargetSettings } from '../../../core/settings'

const VAX780 = { cpuModel: '780', fpu: 'fpu' }, MICROVAX = { cpuModel: 'uvax2', fpu: 'fpu' }, NO_FPU = { cpuModel: 'uvax2', fpu: 'none' }
const services: ArchitectureServices[] = []
afterEach(() => { for (const service of services.splice(0)) service.dispose() })

async function load(code: string, settings: TargetSettings = VAX780) {
	const service = definition.createServices()
	services.push(service)
	await service.prepare?.(settings)
	const program = service.assemble({ files: [{ name: 'main.asm', code }], entries: ['main.asm'] }, settings)
	expect(program.diagnostics).toEqual([])
	return service.createMachine(program, settings, { speed: null, historyLimit: 100000 })
}
function run(machine: Machine, limit = 1_000_000) { for (let i = 0; i < limit && !machine.halted && !machine.pendingInput; i++) machine.step() }
const r = (machine: Machine) => machine.registerValues() as Record<string, number>
const word = (machine: Machine, address: number) => machine.inspectMemory().word(address)
const psl = (machine: Machine) => r(machine).psl & 15
const N = 8, Z = 4, V = 2, C = 1

describe('VAX addressing modes at run time', () => {
	it('applies autoincrement, autodecrement, deferral, displacement and index side effects', async () => {
		const m = await load(`
	MOVAL	DATA, R1
	MOVL	(R1)+, R2		; 11, R1 advances by 4
	MOVL	@(R1)+, R3		; through the pointer at DATA+4 to 33
	MOVL	-(R1), R4		; back to the pointer itself
	MOVL	#2, R5
	MOVL	-4(R1)[R5], R6		; DATA + 4 * 2 = 33
	MOVAL	DATA, R7
	MOVL	@4(R7), R8		; 33 again
	MOVB	#-1, R9			; byte write keeps the upper bits
	MOVL	@#^X10008, R10
	PUSHL	#7
	MOVL	(SP)+, R11
	HALT
	.DATA
DATA:	.LONG	11, THIRD, 33
THIRD = DATA + 8`)
		run(m)
		expect(r(m)).toMatchObject({ r1: 0x10004, r2: 11, r3: 33, r4: 0x10008, r6: 33, r8: 33, r9: 0xff, r10: 33, r11: 7, sp: 0x100000 })
	})

	it('reads PC-relative operands, CASE tables and writes only the low byte or word of a register', async () => {
		const m = await load(`
	MOVL	#^X12345678, R0
	MOVW	#-1, R0
	MOVL	#1, R1
	CASEL	R1, #0, #2
TABLE:	.WORD	A - TABLE, B - TABLE, C - TABLE
	MOVL	#99, R2
	HALT
A:	MOVL	#10, R2
	HALT
B:	MOVL	#20, R2
	HALT
C:	MOVL	#30, R2
	HALT`)
		run(m)
		expect(r(m)).toMatchObject({ r0: 0x1234ffff, r2: 20 })
		const out = await load('\tCASEB\t#5, #0, #1\nT:\t.WORD\t0, 0\n\tMOVL\t#99, R2\n\tHALT')
		run(out)
		expect(r(out).r2).toBe(99)
	})
})

describe('VAX condition codes', () => {
	it.each([
		['ADDL3 #1, #^X7FFFFFFF, R0', 0x80000000, N | V],
		['ADDL3 #1, #-1, R0', 0, Z | C],
		['SUBL3 #1, #0, R0', 0xffffffff, N | C],
		['SUBL3 #1, #^X80000000, R0', 0x7fffffff, V],
		['MULL3 #^X10000, #^X10000, R0', 0, Z | V],
		['DIVL3 #-1, #^X80000000, R0', 0x80000000, N | V],
		['MNEGL #^X80000000, R0', 0x80000000, N | V | C],
		['MOVZBL #^XFF, R0', 0xff, 0],
		['CVTLB #300, R0', 44, V],
		['ASHL #1, #^X40000000, R0', 0x80000000, N | V],
		['ASHL #-1, #-7, R0', 0xfffffffc, N],
		['ROTL #4, #^X12345678, R0', 0x23456781, 0],
		['EMUL #-2, #3, #0, R0', 0xfffffffa, N],
	])('%s', async (instruction, result, flags) => {
		const m = await load(`\t${instruction}\n\tHALT`)
		run(m)
		expect(r(m).r0 >>> 0).toBe(result)
		expect(psl(m)).toBe(flags)
	})

	it('compares signed and unsigned at once', async () => {
		const m = await load('\tCMPL\t#-1, #1\n\tHALT')
		run(m)
		expect(psl(m)).toBe(N)
		const unsigned = await load('\tCMPL\t#1, #-1\n\tHALT')
		run(unsigned)
		expect(psl(unsigned)).toBe(C)
	})

	it('multiplies and divides quadwords with EMUL and EDIV', async () => {
		const m = await load('\tEMUL\t#^X10000, #^X30000, #5, R0\n\tEDIV\t#7, R0, R2, R3\n\tHALT')
		run(m)
		const product = 0x30000_0000n + 5n
		expect(BigInt(r(m).r1) << 32n | BigInt(r(m).r0)).toBe(product)
		expect(r(m)).toMatchObject({ r2: Number(product / 7n), r3: Number(product % 7n) })
	})
})

describe('VAX procedure calls', () => {
	it('builds the CALLS frame from the entry mask and RET restores it', async () => {
		const m = await load(`
	MOVL	#22, R2
	MOVL	#33, R3
	PUSHL	#9
	PUSHL	#8
	CALLS	#2, PROC
	HALT
	.ENTRY	PROC, ^M<R2,R3>
	ADDL3	4(AP), 8(AP), R0
	CLRL	R2
	CLRL	R3
	NOP
	RET`)
		for (let i = 0; i < 6; i++) m.step()
		const fp = r(m).fp
		// Condition handler, mask/PSW (S set, mask bits 2 and 3), AP, FP, PC, then R2 and R3.
		expect([0, 4, 8, 12, 16, 20, 24].map(offset => word(m, fp + offset)! >>> 0)).toEqual([0, (1 << 29 | 0x0c << 16) >>> 0, 0, 0, 0x1011, 22, 33])
		expect(word(m, fp + 28)).toBe(2)
		expect(r(m).ap).toBe(fp + 28)
		expect(m.callStack).toHaveLength(1)
		run(m)
		expect(r(m)).toMatchObject({ r0: 17, r2: 22, r3: 33, sp: 0x100000, fp: 0, ap: 0 })
		expect(m.callStack).toEqual([])
	})

	it('steps over a call and walks back through it', async () => {
		const m = await load('\tPUSHL\t#5\n\tCALLS\t#1, F\n\tHALT\n\t.ENTRY\tF, ^M<R2>\n\tMOVL\t4(AP), R2\n\tMULL3\tR2, R2, R0\n\tRET')
		m.step()
		const before = m.registerValues(), cursor = m.historyCursor
		await m.stepOver()
		expect(r(m).r0).toBe(25)
		expect(m.callStack).toEqual([])
		while (m.historyCursor > cursor) m.stepBack()
		expect(m.registerValues()).toEqual(before)
		expect(m.inspectMemory().word(0xffffc)).toBe(5)
		run(m)
		expect(r(m).r0).toBe(25)
	})
})

describe('VAX floating point', () => {
	it('converts with the documented F and D bit patterns', async () => {
		const m = await load('\tCVTLF\t#1, R0\n\tCVTLD\t#-2, R2\n\tCVTFD\t#0.5, R4\n\tMNEGF\tR0, R6\n\tCVTLG\t#1, R8\n\tHALT')
		run(m)
		expect(r(m)).toMatchObject({ r0: 0x4080, r2: 0xc100, r3: 0, r4: 0x4000, r5: 0, r6: 0xc080, r8: 0x4010, r9: 0 })
	})

	it('rounds ties away from zero, unlike IEEE', async () => {
		// 2^24 + 1 needs 25 bits: a tie between 2^24 and 2^24 + 2.
		const m = await load('\tCVTLF\t#16777217, R0\n\tCVTFL\tR0, R1\n\tCVTRFL\t#2.5, R2\n\tCVTRFL\t#-2.5, R3\n\tCVTFL\t#-2.5, R4\n\tHALT')
		run(m)
		expect(r(m)).toMatchObject({ r1: 16777218, r2: 3, r3: -3 >>> 0, r4: -2 >>> 0 })
	})

	it('faults on reserved operands and floating division by zero', async () => {
		const reserved = await load('\tMOVL\t#^X8000, R0\n\tADDF2\tR0, R1\n\tHALT')
		reserved.step()
		const before = reserved.registerValues()
		expect(() => reserved.step()).toThrow(/Reserved operand/)
		expect(reserved.registerValues()).toEqual(before)
		const zero = await load('\tDIVF2\tR0, R1\n\tHALT')
		expect(() => zero.step()).toThrow(/divide-by-zero/)
		const integer = await load('\tDIVL2\tR0, R1\n\tHALT')
		expect(() => integer.step()).toThrow(/Integer divide-by-zero/)
	})

	it('prints the floating-point example’s results', async () => {
		const m = await load(variantOf(definition, VAX780).examples.floatingpoint.code)
		run(m)
		expect(m.console).toBe('1000 * 22 / 7 = 3142\n22 / 7 * 10^6 = 3142857\nF: 0.1 + 0.2 <= 0.3\nD: 0.1 + 0.2 <= 0.3\nG: 0.1 + 0.2 > 0.3\n')
	})
})

describe('VAX variants', () => {
	it('offers the FPU choice only on the MicroVAX II', () => {
		const field = definition.settings.fields.find(f => f.key === 'fpu')!
		const offered = (settings: TargetSettings) => field.control.kind === 'choice' ? field.control.options.filter(o => !o.when || o.when(settings)).map(o => o.value) : []
		expect(offered(VAX780)).toEqual(['fpu'])
		expect(offered(MICROVAX)).toEqual(['fpu', 'none'])
		expect(variantOf(definition, NO_FPU).examples.floatingpoint).toBeUndefined()
		expect(variantOf(definition, NO_FPU).examples.mandelbrot.code).toMatch(/FPU: none; signed 8.8 fixed point/)
	})

	it.each([
		['ADDH2 R0, R4', VAX780, null],
		['ADDH2 R0, R4', MICROVAX, /MicroVAX II omits H_floating/],
		['MOVO R0, R4', MICROVAX, /octaword/],
		['ADDF2 R0, R1', MICROVAX, null],
		['ADDG2 R0, R2', MICROVAX, null],
		['ADDF2 R0, R1', NO_FPU, /78132/],
		['CVTLD #1, R0', NO_FPU, /78132/],
		['ADDL2 R0, R1', NO_FPU, null],
	] as const)('%s on %j', async (instruction, settings, fault) => {
		const m = await load(`\t${instruction}\n\tHALT`, settings)
		if (fault) expect(() => m.step()).toThrow(fault)
		else { m.step(); expect(m.pc).not.toBe(0x1000) }
	})

	it('identifies the model in the SID register', async () => {
		for (const [settings, sid] of [[VAX780, 0x01000000], [MICROVAX, 0x08000000]] as const) {
			const m = await load('\tMFPR\t#62, R0\n\tHALT', settings)
			run(m)
			expect(r(m).r0).toBe(sid)
		}
	})
})

describe('VAX strings, fields and console', () => {
	it('moves, compares and scans character strings with the documented register results', async () => {
		const m = await load(`
	MOVC3	#5, SOURCE, TARGET
	CMPC3	#5, SOURCE, OTHER
	MOVL	R0, R6
	LOCC	#^A/L/, #5, SOURCE
	MOVL	R0, R7
	HALT
	.DATA
SOURCE:	.ASCII	/HELLO/
OTHER:	.ASCII	/HELP!/
TARGET:	.BLKB	5`)
		run(m)
		const memory = m.inspectMemory()
		expect(Array.from({ length: 5 }, (_, i) => String.fromCharCode(memory.byte(0x1000a + i)!)).join('')).toBe('HELLO')
		expect(r(m)).toMatchObject({ r6: 2, r7: 3, r1: 0x10002 })
	})

	it('extracts, inserts and finds bit fields in registers and memory', async () => {
		const m = await load(`
	MOVL	#^XF0, R1
	EXTZV	#4, #4, R1, R2
	EXTV	#4, #4, R1, R3
	INSV	#5, #8, #4, R1
	FFS	#0, #32, R1, R4
	INSV	#^X3F, #6, #6, FIELD
	EXTZV	#6, #6, FIELD, R5
	HALT
	.DATA
FIELD:	.LONG	0`)
		run(m)
		expect(r(m)).toMatchObject({ r1: 0x5f0, r2: 15, r3: -1 >>> 0, r4: 4, r5: 0x3f })
		expect(m.inspectMemory().word(0x10000)).toBe(0xfc0)
	})

	it('waits for console input in CHMK and prints through MTPR TXDB', async () => {
		const m = await load('\tCHMK\t#5\n\tMTPR\t#^A/>/, #35\n\tCHMK\t#1\n\tHALT')
		run(m)
		expect(m.pendingInput).not.toBeNull()
		expect(m.provideInput('-42')).toBe(true)
		run(m)
		expect(m.console).toBe('>-42')
	})

	it('reports the mask in PUSHR order and assembles case-insensitive symbols and local labels', async () => {
		const m = await load(`
count = 3
start:	movl	#1, r2
	movl	#2, r3
	pushr	#^m<r2,r3>
	clrq	r2
	popr	#^M<R2,R3>
	movl	#COUNT, r4
10$:	sobgtr	r4, 10$
other:	brb	10$
10$:	halt`)
		run(m)
		expect(r(m)).toMatchObject({ r2: 1, r3: 2, r4: 0 })
	})
})
