import type { Example } from '../contracts'
export const EXAMPLES: Record<string, Example> = {
	bitmap: {
		name: 'Bitmap Display',
		description: 'Fill the first 64 pixels at the default data base with a color ramp.',
		code: `.text
_start:
    li t0, 0x10000
    li t1, 64
    li t2, 0x000040ff
pixel:
    sw t2, 0(t0)
    addi t0, t0, 4
    addi t2, t2, 256
    addi t1, t1, -1
    bnez t1, pixel
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
