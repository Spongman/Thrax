// Floating-point Arithmetic
// Double-precision arithmetic in the D views of V0-V31, printed to three
// decimal places. Open the FP tab of the Registers panel to watch them,
// and FPSR collect the Inexact flag (0x10) as results round.

	.data
pi:	.double 3.141592653589793
radius:	.double 2.5
sqrtLabel:	.asciz "sqrt(2) = "
areaLabel:	.asciz "pi * 2.5^2 = "
thirdLabel:	.asciz "1 / 3 = "
roundLabel:	.asciz "frintn(-7.5) = "

	.text
	.global _start
_start:
	fmov d8, #2.0
	fsqrt d0, d8            // sqrt(2), rounded to nearest
	ldr x0, =sqrtLabel
	bl print_line

	ldr x9, =pi
	ldr d9, [x9]
	ldr d10, [x9, #8]       // radius, the next doubleword
	fmul d10, d10, d10
	fmul d0, d9, d10        // pi * r * r
	ldr x0, =areaLabel
	bl print_line

	mov w1, #1
	scvtf d1, w1
	mov w2, #3
	scvtf d2, w2
	fdiv d0, d1, d2         // 1 / 3, inexact
	ldr x0, =thirdLabel
	bl print_line

	fmov d3, #-7.5
	frintn d0, d3           // ties to even: -8
	ldr x0, =roundLabel
	bl print_line

	mov x0, #0              // status
	mov x8, #93             // exit
	svc #0

// print_line(x0, d0): the string at x0, then d0 to three places, then a newline.
print_line:
	stp x29, x30, [sp, #-32]!
	str d0, [sp, #16]
	bl print_string
	ldr d0, [sp, #16]
	bl print_fixed
	mov w0, #'\n'
	bl print_char
	ldp x29, x30, [sp], #32
	ret

// print_fixed(d0): d0 rounded to three decimal places.
print_fixed:
	stp x29, x30, [sp, #-32]!
	str x19, [sp, #16]
	fcmp d0, #0.0
	b.pl 1f
	fneg d0, d0
	mov w0, #'-'
	bl print_char
1:	mov x1, #1000
	scvtf d1, x1
	fmul d0, d0, d1
	fcvtas x19, d0          // thousandths, ties away from zero
	udiv x0, x19, x1
	bl print_decimal        // the whole part
	mov w0, #'.'
	bl print_char
	mov x1, #1000
	udiv x2, x19, x1
	msub x19, x2, x1, x19   // the thousandths left over
	mov x1, #100
2:	udiv x0, x19, x1        // each digit, leading zeros kept
	msub x19, x0, x1, x19
	add w0, w0, #'0'
	str x1, [sp, #24]
	bl print_char
	ldr x1, [sp, #24]
	mov x2, #10
	udiv x1, x1, x2
	cbnz x1, 2b
	ldr x19, [sp, #16]
	ldp x29, x30, [sp], #32
	ret

// print_string(x0): write the zero-terminated string at x0.
print_string:
	mov x1, x0              // buffer
	mov x2, #0              // length so far
1:	ldrb w3, [x1, x2]
	cbz w3, 2f              // stop at the terminating zero
	add x2, x2, #1
	b 1b
2:	mov x0, #1              // fd 1
	mov x8, #64             // write(1, x1, x2)
	svc #0
	ret

// print_decimal(x0): write x0 in decimal, all 64 bits of it.
print_decimal:
	sub sp, sp, #32         // room for 20 digits
	add x1, sp, #32         // x1 walks back from the end of the buffer
	mov x2, #10
1:	udiv x3, x0, x2         // x3 = x0 / 10
	msub x4, x3, x2, x0     // x4 = x0 - x3 * 10, the lowest digit
	add w4, w4, #'0'
	strb w4, [x1, #-1]!
	mov x0, x3
	cbnz x0, 1b
	mov x0, #1              // fd 1
	add x2, sp, #32
	sub x2, x2, x1          // length: from x1 to the end
	mov x8, #64             // write(1, x1, x2)
	svc #0
	add sp, sp, #32
	ret

// print_char(w0): write one character.
print_char:
	strb w0, [sp, #-16]!    // the character, on a 16-byte aligned stack
	mov x0, #1              // fd 1: standard output
	mov x1, sp              // buffer
	mov x2, #1              // one byte
	mov x8, #64             // write
	svc #0
	add sp, sp, #16
	ret
