import { describe, expect, it } from 'vitest'
import { assembleMos6502 } from '../assembler'
import { FLAG_C, FLAG_D, FLAG_I, FLAG_N, FLAG_U, FLAG_V, FLAG_Z, Mos6502Cpu, STEP_HALT, STEP_OK } from '../cpu'
import { Mos6502Machine } from '../machine'

/** Assembles `code` and runs it until BRK halts it, as a program with no IRQ vector does. */
function run(code: string, options: { decimal?: boolean } = {}) {
	const { image, diagnostics } = assembleMos6502({ name: 'test.s', code })
	expect(diagnostics).toEqual([])
	const machine = new Mos6502Machine(options)
	machine.load(image!)
	const status = machine.run(100_000)
	return { machine, cpu: machine.cpu, status }
}

const flags = (p: number) => ['N', 'V', 'Z', 'C'].filter((_, index) => p & [FLAG_N, FLAG_V, FLAG_Z, FLAG_C][index]).join('')

/** A with the flags an ADC or SBC of `a` and `b` left, carry in as given. */
function arithmetic(op: 'adc' | 'sbc', a: number, b: number, carry: boolean, decimal: boolean) {
	const { cpu } = run(`${decimal ? 'sed' : 'cld'}\n${carry ? 'sec' : 'clc'}\nlda #${a}\n${op} #${b}\nbrk\n`)
	return { a: cpu.a, flags: flags(cpu.p) }
}

describe('6502 binary arithmetic', () => {
	// The overflow table of 6502.org's "The Overflow (V) Flag Explained".
	it.each([
		[0x50, 0x10, 0x60, ''], [0x50, 0x50, 0xA0, 'NV'], [0x50, 0x90, 0xE0, 'N'], [0x50, 0xD0, 0x20, 'C'],
		[0xD0, 0x10, 0xE0, 'N'], [0xD0, 0x50, 0x20, 'C'], [0xD0, 0x90, 0x60, 'VC'], [0xD0, 0xD0, 0xA0, 'NC'],
		[0xFF, 0x01, 0x00, 'ZC'],
	])('ADC $%s + $%s = $%s, %s', (a, b, result, expected) => {
		expect(arithmetic('adc', a, b, false, false)).toEqual({ a: result, flags: expected })
	})

	it.each([
		[0x50, 0xF0, 0x60, ''], [0x50, 0xB0, 0xA0, 'NV'], [0x50, 0x70, 0xE0, 'N'], [0x50, 0x30, 0x20, 'C'],
		[0xD0, 0xF0, 0xE0, 'N'], [0xD0, 0xB0, 0x20, 'C'], [0xD0, 0x70, 0x60, 'VC'], [0xD0, 0x30, 0xA0, 'NC'],
		[0x40, 0x40, 0x00, 'ZC'],
	])('SBC $%s - $%s = $%s, %s', (a, b, result, expected) => {
		expect(arithmetic('sbc', a, b, true, false)).toEqual({ a: result, flags: expected })
	})
})

describe('6502 decimal mode, NMOS', () => {
	// Bruce Clark, "Decimal Mode", 6502.org tutorial: worked NMOS results.
	it.each([
		[0x00, 0x00, false, 0x00, 'Z'],
		[0x79, 0x00, true, 0x80, 'NV'],
		[0x24, 0x56, false, 0x80, 'NV'],
		[0x93, 0x82, false, 0x75, 'VC'],
		[0x89, 0x76, false, 0x65, 'C'],
		// Z follows the binary sum, $100.
		[0x89, 0x76, true, 0x66, 'ZC'],
		[0x80, 0xF0, false, 0xD0, 'VC'],
		[0x80, 0xFA, false, 0xE0, 'NC'],
		// Invalid BCD digits.
		[0x2F, 0x4F, false, 0x74, ''],
		[0x6F, 0x00, true, 0x76, ''],
		[0x58, 0x46, true, 0x05, 'NVC'],
		[0x99, 0x01, false, 0x00, 'NC'],
	])('ADC $%s + $%s carry %s = $%s, %s', (a, b, carry, result, expected) => {
		expect(arithmetic('adc', a, b, carry, true)).toEqual({ a: result, flags: expected })
	})

	it.each([
		[0x00, 0x00, false, 0x99, 'N'],
		[0x00, 0x00, true, 0x00, 'ZC'],
		[0x00, 0x01, true, 0x99, 'N'],
		[0x0A, 0x00, true, 0x0A, 'C'],
		[0x0B, 0x00, false, 0x0A, 'C'],
		[0x9A, 0x00, true, 0x9A, 'NC'],
		[0x9B, 0x00, false, 0x9A, 'NC'],
		[0x46, 0x12, true, 0x34, 'C'],
		[0x12, 0x21, true, 0x91, 'N'],
	])('SBC $%s - $%s carry %s = $%s, %s', (a, b, carry, result, expected) => {
		expect(arithmetic('sbc', a, b, carry, true)).toEqual({ a: result, flags: expected })
	})

	it('ignores D when decimal mode is off, as the 2A03 does', () => {
		const { cpu } = run('sed\nclc\nlda #$09\nadc #$01\nbrk\n', { decimal: false })
		expect(cpu.a).toBe(0x0A)
		expect(cpu.p & FLAG_D).toBe(FLAG_D)
	})
})

describe('6502 flags of other instructions', () => {
	it('compares as an unsigned subtraction', () => {
		expect(flags(run('lda #$40\ncmp #$40\nbrk').cpu.p)).toBe('ZC')
		expect(flags(run('ldx #$40\ncpx #$41\nbrk').cpu.p)).toBe('N')
		expect(flags(run('ldy #$41\ncpy #$40\nbrk').cpu.p)).toBe('C')
		expect(flags(run('lda #$01\ncmp #$FF\nbrk').cpu.p)).toBe('')
	})

	it('copies bits 7 and 6 of memory into N and V on BIT, Z from the AND', () => {
		expect(flags(run('lda #$C0\nsta $10\nlda #$01\nbit $10\nbrk').cpu.p)).toBe('NVZ')
		expect(flags(run('lda #$01\nsta $10\nbit $10\nbrk').cpu.p)).toBe('')
	})

	it('shifts and rotates through carry', () => {
		const { cpu } = run('lda #$81\nasl a\nsta $10\nrol $10\nlda #$01\nlsr\nror a\nbrk')
		expect(cpu.memory[0x10]).toBe(0x05)
		expect(cpu.a).toBe(0x80)
		expect(flags(cpu.p)).toBe('N')
	})

	it('wraps INC and DEC, and leaves TXS flags alone', () => {
		const { cpu } = run('ldx #$FF\ninx\nstx $10\ndec $10\nldx #$80\ntxs\nbrk')
		expect(cpu.memory[0x10]).toBe(0xFF)
		expect(cpu.sp).toBe(0x80)
		expect(flags(cpu.p)).toBe('N')
	})

	it('pushes B and bit 5 with PHP and ignores B on PLP', () => {
		const { cpu } = run('lda #$FF\npha\nplp\nphp\nbrk')
		expect(cpu.memory[0x01FD]).toBe(0xFF)
		expect(cpu.p).toBe(0xFF & ~0x10)
	})
})

describe('6502 addressing edge cases', () => {
	it('takes JMP ($xxFF)\'s high byte from the start of the same page', () => {
		const { cpu } = run('lda #$34\nsta $10FF\nlda #$12\nsta $1000\nlda #$56\nsta $1100\njmp ($10FF)\n.org $1234\nbrk\n.org $5634\nnop\n')
		expect(cpu.pc).toBe(0x1234)
	})

	it('wraps zero-page indexing and pointers within page 0', () => {
		const { cpu } = run([
			'lda #$11', 'sta $7F', 'ldx #$FF', 'lda $80,x', 'sta $20',
			// (zp),Y with the pointer at $FF: its high byte is at $00.
			'lda #$00', 'sta $FF', 'lda #$30', 'sta $00', 'lda #$22', 'sta $3005', 'ldy #5', 'lda ($FF),y', 'sta $21',
			// (zp,X) wrapping past $FF onto $00.
			'lda #$30', 'sta $01', 'lda #$33', 'sta $3030', 'ldx #1', 'lda ($FF,x)', 'sta $22',
			'brk',
		].join('\n'))
		expect([cpu.memory[0x20], cpu.memory[0x21], cpu.memory[0x22]]).toEqual([0x11, 0x22, 0x33])
	})

	it('wraps absolute indexing at $FFFF', () => {
		const { cpu } = run('lda #$44\nsta $01\nldx #2\nlda $FFFF,x\nbrk')
		expect(cpu.a).toBe(0x44)
	})

	it('keeps the stack in page 1, wrapping SP', () => {
		const { cpu } = run('ldx #0\ntxs\nlda #$5A\npha\npha\nbrk')
		expect([cpu.memory[0x0100], cpu.memory[0x01FF], cpu.sp]).toEqual([0x5A, 0x5A, 0xFE])
	})

	it('pushes the address of the JSR\'s last byte, and RTS returns past it', () => {
		const { cpu } = run('.org $0600\njsr sub\nbrk\nsub: tsx\nstx $10\nrts\n')
		expect([cpu.memory[0x01FD], cpu.memory[0x01FC], cpu.memory[0x10]]).toEqual([0x06, 0x02, 0xFB])
		expect(cpu.pc).toBe(0x0603)
		expect(cpu.sp).toBe(0xFD)
	})
})

describe('6502 cycles', () => {
	/** Cycles `code` takes before the BRK that ends it. */
	const cycles = (code: string) => {
		const { image } = assembleMos6502({ name: 't.s', code: `${code}\nbrk\n` })
		const machine = new Mos6502Machine()
		machine.load(image!)
		machine.run(10_000)
		return machine.cpu.cycles - 7
	}

	it('counts base cycles', () => {
		expect(cycles('lda #1\nsta $10\nlda $10\ninc $1000\njsr sub\nbrk\nsub: rts')).toBe(2 + 3 + 3 + 6 + 6 + 6)
	})

	it('adds a cycle when indexing crosses a page, for reads only', () => {
		expect(cycles('ldx #1\nlda $10FE,x')).toBe(2 + 4)
		expect(cycles('ldx #1\nlda $10FF,x')).toBe(2 + 5)
		expect(cycles('ldx #1\nsta $10FF,x')).toBe(2 + 5)
		expect(cycles('ldx #1\nsta $10FE,x')).toBe(2 + 5)
		expect(cycles('lda #$FF\nsta $10\nlda #$10\nsta $11\nldy #1\nlda ($10),y')).toBe(2 + 3 + 2 + 3 + 2 + 6)
	})

	it('adds a cycle for a taken branch and another for crossing a page', () => {
		expect(cycles('lda #1\nbeq *+2')).toBe(2 + 2)
		expect(cycles('lda #0\nbeq next\nnext:')).toBe(2 + 3)
		expect(cycles('.org $06F0\nlda #0\nbeq next\n.res 20\nnext:')).toBe(2 + 4)
	})
})

describe('6502 BRK, RTI and faults', () => {
	it('enters the IRQ vector on BRK with B pushed and returns past its padding byte', () => {
		const code = [
			'.org $0600', 'cli', 'brk', '.byte $EA', 'lda #1', 'sta $F003',
			'handler: pla', 'sta $10', 'pha', 'inc $11', 'rti',
			'.org $FFFE', '.word handler',
		].join('\n')
		const { machine, cpu } = run(code)
		expect(machine.halted).toBe(true)
		expect(machine.exitCode).toBe(1)
		expect(cpu.memory[0x10] & 0x30).toBe(0x30)
		expect(cpu.memory[0x11]).toBe(1)
		// The return skipped BRK's padding byte, so the halt came after LDA and STA.
		expect(cpu.pc).toBe(0x0608)
	})

	it('halts on BRK when the program has no IRQ vector', () => {
		const { machine, status, cpu } = run('nop\nbrk\nnop')
		expect(status).toBe(STEP_HALT)
		expect(machine.halted).toBe(true)
		expect(cpu.pc).toBe(0x0601)
	})

	it('jams on KIL until reset without advancing PC', () => {
		const cpu = new Mos6502Cpu()
		cpu.memory[0x0200] = 0x02
		cpu.pc = 0x0200
		cpu.a = 5
		expect(cpu.step()).toBe(STEP_OK)
		expect([cpu.pc, cpu.a]).toEqual([0x0200, 5])
		expect(cpu.stopped).toBe(true)
		expect(cpu.step()).toBe(STEP_HALT)
		cpu.interrupt(0xFFFA)
		expect(cpu.pc).toBe(0x0200)
		cpu.reset()
		expect(cpu.stopped).toBe(false)
	})

	it('resets with I set, SP $FD and PC from the vector', () => {
		const cpu = new Mos6502Cpu()
		cpu.memory[0xFFFC] = 0x34
		cpu.memory[0xFFFD] = 0x12
		cpu.reset()
		expect([cpu.pc, cpu.sp, cpu.p]).toEqual([0x1234, 0xFD, FLAG_U | FLAG_I])
		cpu.memory[0x1234] = 0xEA
		expect(cpu.step()).toBe(STEP_OK)
		expect(cpu.cycles).toBe(9)
	})
})
