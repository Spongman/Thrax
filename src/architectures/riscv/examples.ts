import type { Example } from '../contracts'
import { mandelbrot } from './mandelbrot'
export const EXAMPLES: Record<string, Example> = {
	mandelbrot,
	ackermann: {
		name: 'Ackermann',
		description: 'Nested recursive calls with stack frames compute and print A(3, 3) = 61.',
		code: `.text
_start:
li a0, 3
li a1, 3
call ack
li a7, 1
ecall
ebreak
ack:
beqz a0, base
beqz a1, zero
addi sp, sp, -16
sw ra, 12(sp)
sw a0, 8(sp)
addi a1, a1, -1
call ack
mv a1, a0
lw a0, 8(sp)
addi a0, a0, -1
call ack
lw ra, 12(sp)
addi sp, sp, 16
ret
zero:
addi a0, a0, -1
li a1, 1
j ack
base:
addi a0, a1, 1
ret
`,
	},
	bitmap: {
		tools: ['bitmap'],
		name: 'Bitmap Display',
		description: 'Draw the common 32 by 32 red/blue gradient at the default data base.',
		code: `.text
_start:
    li t0, 0x10000
    li t1, 0
    li t6, 32
row:
    li t2, 0
pixel:
    slli t3, t1, 19
    slli t4, t2, 3
    or t5, t3, t4
    sw t5, 0(t0)
    addi t0, t0, 4
    addi t2, t2, 1
    blt t2, t6, pixel
    addi t1, t1, 1
    blt t1, t6, row
    ebreak
`
	},
	hello: {
		name: 'Hello, THRAX!',
		description: 'RV32IM educational ECALL console: a7 selects the service, a0 the argument.',
		code: `.data
message: .asciz "Hello, THRAX!\\n"
.text
.globl _start
_start:
    la a0, message
    li a7, 4
    ecall
    li a7, 10
    ecall
`
	},
	factorial: {
		name: 'Factorial',
		description: 'A function call and the M extension compute 5!; prints 120.',
		code: `.text
_start:
    li a0, 5
    call factorial
    li a7, 1
    ecall
    li a7, 10
    ecall
factorial:
    mv t0, a0
    li a0, 1
loop:
    beqz t0, done
    mul a0, a0, t0
    addi t0, t0, -1
    j loop
done:
    ret
`
	},
	sum: {
		name: 'Sum of Numbers',
		description: 'Add 5 and 3; prints 8.',
		code: `.text
_start:
    li a0, 5
    li t0, 3
    add a0, a0, t0
    li a7, 1
    ecall
    ebreak
`
	},
	fibonacci: {
		name: 'Fibonacci',
		description: 'Compute Fibonacci(10); prints 55.',
		code: `.text
_start:
    li a0, 0
    li t0, 1
    li t1, 10
next:
    add t2, a0, t0
    mv a0, t0
    mv t0, t2
    addi t1, t1, -1
    bnez t1, next
    li a7, 1
    ecall
    ebreak
`
	},
	loop: {
		name: 'Loop Counter',
		description: 'Print the numbers 1 through 5 on separate lines.',
		code: `.text
_start:
    li t0, 1
    li t1, 6
next:
    mv a0, t0
    li a7, 1
    ecall
    li a0, 10
    li a7, 11
    ecall
    addi t0, t0, 1
    blt t0, t1, next
    ebreak
`
	},
	bitwise: {
		name: 'Bitwise Operations',
		description: 'Combine 12 and 10; print AND = 8, OR = 14 and XOR = 6 on separate lines.',
		code: `.text
_start:
    li t0, 12
    li t1, 10
    and a0, t0, t1
    call print_line
    or a0, t0, t1
    call print_line
    xor a0, t0, t1
    call print_line
    ebreak
print_line:
    li a7, 1
    ecall
    li a0, 10
    li a7, 11
    ecall
    ret
`
	},
	input: {
		name: 'Interactive Input',
		description: 'Read a signed integer using educational ECALL 5, then print it unchanged.',
		code: `.text
_start:
    li a7, 5
    ecall
    li a7, 1
    ecall
    ebreak
`
	},
	memory: {
		name: 'Memory and Rewind',
		description: 'Word stores, signed loads and an EBREAK stop.',
		code: `.data
value: .word 0
.text
_start:
    la t0, value
    li t1, -128
    sb t1, 0(t0)
    lb a0, 0(t0)
    li a7, 1
    ecall
    ebreak
`
	}
}

export const COMPRESSED_EXAMPLES: Record<string, Example> = {
	...EXAMPLES,
	compressed: {
		name: 'Compressed Instructions',
		description:
			'Mixed 16-bit and 32-bit instructions, a compressed call and a stack word; prints 42.',
		code: `.text
_start:
    c.addi16sp sp, -16
    c.li a0, 21
    c.swsp a0, 0(sp)
    c.jal twice
    c.addi16sp sp, 16
    li a7, 1
    ecall
    c.ebreak
twice:
    c.lwsp a0, 0(sp)
    c.slli a0, 1
    c.jr ra
`
	}
}
