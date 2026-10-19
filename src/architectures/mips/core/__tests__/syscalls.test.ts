import { describe, expect, it } from 'vitest'
import { JavaRandom } from '../random'
import { build, output, run, withExit } from './helpers'

describe('file syscalls', () => {
	it('writes a file and reads it back', async () => {
		const source = withExit(`
.data
name:	.asciiz "notes.txt"
text:	.asciiz "hello"
buffer:	.space 16
.text
	# fd = open(name, write)
	la $a0, name
	li $a1, 1
	li $v0, 13
	syscall
	move $s0, $v0

	# write(fd, text, 5)
	move $a0, $s0
	la $a1, text
	li $a2, 5
	li $v0, 15
	syscall

	move $a0, $s0
	li $v0, 16
	syscall

	# fd = open(name, read)
	la $a0, name
	li $a1, 0
	li $v0, 13
	syscall
	move $s0, $v0

	# read(fd, buffer, 16)
	move $a0, $s0
	la $a1, buffer
	li $a2, 16
	li $v0, 14
	syscall
	move $s1, $v0

	la $a0, buffer
	li $v0, 4
	syscall
`)
		const simulator = await run(source)
		expect(simulator.console).toBe('hello')
		expect(simulator.registers.$s1).toBe(5)
	})

	it('sends writes on descriptor 1 to the console', async () => {
		const source = withExit('.data\ntext: .asciiz "out"\n.text\nli $a0, 1\nla $a1, text\nli $a2, 3\nli $v0, 15\nsyscall')
		expect(await output(source)).toBe('out')
	})

	it('reports -1 when opening a file that was never written', async () => {
		const source = withExit('.data\nname: .asciiz "missing.txt"\n.text\nla $a0, name\nli $a1, 0\nli $v0, 13\nsyscall\nmove $s0, $v0')
		expect((await run(source)).registers.$s0).toBe(-1)
	})

	it('reports no status from a close', async () => {
		// `SyscallClose.java:28-30` calls a void `SystemIO.closeFile` and never
		// touches $v0, so $v0 still holds the service number afterwards.
		const source = withExit(`
.data
name:	.asciiz "c.txt"
.text
	la $a0, name
	li $a1, 1
	li $v0, 13
	syscall
	move $a0, $v0
	li $v0, 16
	syscall
	move $s0, $v0
	li $a0, 99
	li $v0, 16
	syscall
	move $s1, $v0
`)
		const simulator = await run(source)
		expect(simulator.registers.$s0).toBe(16)
		expect(simulator.registers.$s1).toBe(16)
	})

	it('appends to an existing file rather than truncating it', async () => {
		const source = withExit(`
.data
name:	.asciiz "log.txt"
first:	.asciiz "ab"
second:	.asciiz "cd"
.text
	la $a0, name
	li $a1, 1
	li $v0, 13
	syscall
	move $s0, $v0
	move $a0, $s0
	la $a1, first
	li $a2, 2
	li $v0, 15
	syscall
	move $a0, $s0
	li $v0, 16
	syscall

	la $a0, name
	li $a1, 9
	li $v0, 13
	syscall
	move $s0, $v0
	move $a0, $s0
	la $a1, second
	li $a2, 2
	li $v0, 15
	syscall
`)
		const simulator = await run(source)
		expect(simulator.files.contentsOf('log.txt')).toEqual([97, 98, 99, 100])
	})
})

describe('time and sleep syscalls', () => {
	it('reports the clock as a 64-bit millisecond count', async () => {
		const simulator = build(withExit('li $v0, 30\nsyscall'))
		simulator.clock = () => 0x1_0000_0005
		await simulator.run()
		expect(simulator.registers.$a0).toBe(5)
		expect(simulator.registers.$a1).toBe(1)
	})

	it('asks the run loop to wait, without halting', async () => {
		const simulator = build(withExit('li $a0, 1\nli $v0, 32\nsyscall\nli $t0, 7'))
		await simulator.run()
		expect(simulator.registers.$t0).toBe(7)
		expect(simulator.halted).toBe(true)
	})
})

describe('random syscalls', () => {
	it('matches the reference generator for a given seed', async () => {
		const source = withExit('li $a0, 0\nli $a1, 42\nli $v0, 40\nsyscall\nli $a0, 0\nli $v0, 41\nsyscall\nmove $s0, $a0')
		const expected = new JavaRandom(42).nextInt()
		expect((await run(source)).registers.$s0).toBe(expected)
	})

	it('keeps a bounded draw inside the range', async () => {
		const source = withExit(`
li $a0, 1
li $a1, 7
li $v0, 40
syscall
li $s0, 0
li $s1, 200
loop:
li $a0, 1
li $a1, 6
li $v0, 42
syscall
sltiu $t0, $a0, 6
beq $t0, $zero, bad
addi $s0, $s0, 1
bne $s0, $s1, loop
li $s2, 1
j done
bad:
li $s2, 0
done:
`)
		expect((await run(source)).registers.$s2).toBe(1)
	})

	it('keeps separate streams for separate identifiers', async () => {
		const source = withExit(`
li $a0, 0
li $a1, 99
li $v0, 40
syscall
li $a0, 1
li $a1, 99
li $v0, 40
syscall
li $a0, 0
li $v0, 41
syscall
move $s0, $a0
li $a0, 1
li $v0, 41
syscall
move $s1, $a0
`)
		const simulator = await run(source)
		// Same seed, different streams: the first draw of each has to agree.
		expect(simulator.registers.$s0).toBe(simulator.registers.$s1)
	})

	it('draws a float in [0, 1)', async () => {
		const simulator = await run(withExit('li $a0, 0\nli $a1, 3\nli $v0, 40\nsyscall\nli $a0, 0\nli $v0, 43\nsyscall'))
		const value = simulator.readFpSingle(0)
		expect(value).toBeGreaterThanOrEqual(0)
		expect(value).toBeLessThan(1)
	})
})

describe('dialog syscalls', () => {
	it('prompts for an integer and reports success in $a1', async () => {
		const source = withExit('.data\nask: .asciiz "How many?"\n.text\nla $a0, ask\nli $v0, 51\nsyscall')
		const simulator = build(source)
		await simulator.run()
		expect(simulator.pendingInput).toMatchObject({ type: 'integer', dialog: true, prompt: 'How many?' })
		simulator.provideInput('12')
		await simulator.run()
		expect(simulator.registers.$a0).toBe(12)
		expect(simulator.registers.$a1).toBe(0)
	})

	it('reports bad input and cancellation distinctly', async () => {
		const source = withExit('.data\nask: .asciiz "n?"\n.text\nla $a0, ask\nli $v0, 51\nsyscall')

		const bad = build(source)
		await bad.run()
		bad.provideInput('not a number')
		expect(bad.registers.$a1).toBe(-1)

		const cancelled = build(source)
		await cancelled.run()
		cancelled.provideInput('', true)
		expect(cancelled.registers.$a1).toBe(-2)
	})

	it('answers a confirmation dialog in $a0', async () => {
		const source = withExit('.data\nask: .asciiz "Sure?"\n.text\nla $a0, ask\nli $v0, 50\nsyscall')

		const yes = build(source)
		await yes.run()
		yes.provideInput('yes')
		expect(yes.registers.$a0).toBe(0)

		const no = build(source)
		await no.run()
		no.provideInput('no')
		expect(no.registers.$a0).toBe(1)

		const cancelled = build(source)
		await cancelled.run()
		cancelled.provideInput('', true)
		expect(cancelled.registers.$a0).toBe(2)
	})

	it('reads a dialog string into the buffer $a1 names', async () => {
		const source = withExit('.data\nask: .asciiz "name?"\nbuffer: .space 16\n.text\nla $a0, ask\nla $a1, buffer\nli $a2, 16\nli $v0, 54\nsyscall\nla $a0, buffer\nli $v0, 4\nsyscall')
		const simulator = build(source)
		await simulator.run()
		simulator.provideInput('ada')
		await simulator.run()
		// A string that fits is newline-terminated inside the buffer
		// (`SyscallInputDialogString.java:59-63`).
		expect(simulator.console).toBe('ada\n')
		expect(simulator.registers.$a1).toBe(0)
	})

	it('reports -4 when the string does not fit the buffer', async () => {
		// `SyscallInputDialogString.java:64-72`: the buffer is $a2 bytes, one of
		// them the terminator, and $a1 is -4 when the input was longer.
		const source = withExit('.data\nask: .asciiz "n?"\nbuffer: .space 8\n.text\nla $a0, ask\nla $a1, buffer\nli $a2, 4\nli $v0, 54\nsyscall\nla $a0, buffer\nli $v0, 4\nsyscall')
		const simulator = build(source)
		await simulator.run()
		simulator.provideInput('abcdef')
		await simulator.run()
		expect(simulator.console).toBe('abc')
		expect(simulator.registers.$a1).toBe(-4)
	})

	it('reports an empty field apart from bad input, and zeroes the value', async () => {
		// `SyscallInputDialogInt.java:63-70`: cancel is -2, OK with nothing typed
		// is -3, and $a0 is zeroed in both cases.
		const source = withExit('.data\nask: .asciiz "n?"\n.text\nla $a0, ask\nli $v0, 51\nsyscall')

		const empty = build(source)
		await empty.run()
		empty.provideInput('')
		expect(empty.registers.$a1).toBe(-3)
		expect(empty.registers.$a0).toBe(0)

		const bad = build(source)
		await bad.run()
		bad.provideInput('not a number')
		expect(bad.registers.$a1).toBe(-1)
		expect(bad.registers.$a0).toBe(0)
	})

	it('prints message dialogs to the console', async () => {
		const source = withExit(`
.data
warn:	.asciiz "look out"
count:	.asciiz "n = "
.text
	la $a0, warn
	li $a1, 2
	li $v0, 55
	syscall
	la $a0, count
	li $a1, 41
	li $v0, 56
	syscall
`)
		expect(await output(source)).toBe('Warning: look out\nn = 41\n')
	})
})

describe('midi syscalls', () => {
	it('hands the note to the player and returns at once', async () => {
		const played: unknown[] = []
		const simulator = build(withExit('li $a0, 60\nli $a1, 5\nli $a2, 0\nli $a3, 100\nli $v0, 31\nsyscall'))
		simulator.midi = { play: (note) => played.push(note) }
		await simulator.run()
		expect(played).toEqual([{ pitch: 60, durationMs: 5, instrument: 0, volume: 100 }])
	})

	it('stays silent when no player is attached', async () => {
		const simulator = await run(withExit('li $a0, 60\nli $a1, 1\nli $v0, 33\nsyscall\nli $t0, 1'))
		expect(simulator.registers.$t0).toBe(1)
	})

	it('falls back to the default note for out-of-range arguments', async () => {
		// `SyscallMidiOut.java:60-63` replaces a value outside 0-127 with the
		// default from `ToneGenerator.java:69-84`; it does not mask the low bits.
		const played: unknown[] = []
		const simulator = build(withExit('li $a0, 200\nli $a1, -1\nli $a2, 300\nli $a3, 999\nli $v0, 31\nsyscall'))
		simulator.midi = { play: (note) => played.push(note) }
		await simulator.run()
		expect(played).toEqual([{ pitch: 60, durationMs: 1000, instrument: 0, volume: 100 }])
	})

	it('waits out the default duration when syscall 33 is given a negative one', async () => {
		const simulator = build(withExit('li $a0, 60\nli $a1, -1\nli $v0, 33\nnoteCall:\nsyscall'))
		await simulator.runTo(simulator.program.labels.get('noteCall')!)
		simulator.step()
		expect(simulator.pendingSleepMs).toBe(1000)
	})
})

describe('clear screen', () => {
	it('empties the console and keeps running', async () => {
		// `SyscallClearScreen.java:18` empties the run text area.
		const source = withExit('.data\nnoise: .asciiz "noise"\nkept: .asciiz "kept"\n.text\nla $a0, noise\nli $v0, 4\nsyscall\nli $v0, 60\nsyscall\nla $a0, kept\nli $v0, 4\nsyscall')
		expect(await output(source)).toBe('kept')
	})
})

describe('exit code', () => {
	it('records the code syscall 17 exits with', async () => {
		expect((await run('li $a0, 3\nli $v0, 17\nsyscall')).exitCode).toBe(3)
	})
})
