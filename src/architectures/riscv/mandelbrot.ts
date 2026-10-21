import type { Example } from '../contracts'

export const mandelbrot: Example = {
	name: 'Mandelbrot Set',
	description: 'The M extension draws the 32 by 32 Mandelbrot view in signed 8.8 fixed point.',
	tools: ['bitmap'],
	code: `# Same view as the 6502 port. RGB pixels start at the default data base.
.equ MAXITER, 16
.text
_start:
	la t0, pixels
	li s2, -320            # ci
	li s3, 0               # row
row:
	li s1, -512            # cr
	li s4, 0               # column
column:
	li a0, 0               # zr
	li a1, 0               # zi
	li s5, 0               # iterations
iterate:
	mul a2, a0, a0
	srai a2, a2, 8
	mul a3, a1, a1
	srai a3, a3, 8
	add a5, a2, a3
	li t3, 1024
	bge a5, t3, escaped
	mul a4, a0, a1
	bge a4, zero, positive
	addi a4, a4, 255       # truncate the signed product toward zero
positive:
	srai a4, a4, 8
	slli a4, a4, 1
	add a1, a4, s2
	sub a0, a2, a3
	add a0, a0, s1
	addi s5, s5, 1
	li t3, MAXITER
	blt s5, t3, iterate
escaped:
	slli t2, s5, 2
	la t1, palette
	add t1, t1, t2
	lw t1, 0(t1)
plot:
	sw t1, 0(t0)
	addi t0, t0, 4
	addi s1, s1, 20
	addi s4, s4, 1
	li t3, 32
	blt s4, t3, column
	addi s2, s2, 20
	addi s3, s3, 1
	blt s3, t3, row
	ebreak
.data
pixels: .space 4096
palette:
	.word 0x000030, 0x00104a, 0x001f66, 0x003080
	.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
	.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
	.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
	.word 0x000000
`,
}
