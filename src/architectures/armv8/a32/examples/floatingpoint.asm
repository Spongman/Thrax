@ Floating-point Arithmetic
@ VFP in double and single precision: a square root, a product with
@ constants from memory, a division, and rounding to an integer.

@ S0-S31 and D0-D15 are one register file: D0 is S1:S0. Results are
@ printed to three decimal places by scaling by 1000 and converting to
@ an integer with VCVTR, which rounds as FPSCR says: to nearest, ties to
@ even, by default.

	.data
pi:		.double 3.141592653589793
radius:		.double 2.5
thousand:	.double 1000.0
halves:		.float 2.5, 3.5
sqrtText:	.asciz "sqrt(2) = "
areaText:	.asciz "pi * 2.5^2 = "
thirdText:	.asciz "1 / 3 = "
roundText:	.asciz "round(2.5) = "
roundText2:	.asciz ", round(3.5) = "
newline:	.asciz "\n"

	.text
	.global _start
_start:
	ldr r1, =sqrtText
	bl print_string
	vmov.f64 d0, #2.0
	vsqrt.f64 d0, d0
	bl print_fixed3

	ldr r1, =areaText
	bl print_string
	ldr r0, =pi
	vldr d0, [r0]
	ldr r0, =radius
	vldr d1, [r0]
	vmul.f64 d1, d1, d1             @ r^2
	vmul.f64 d0, d0, d1
	bl print_fixed3

	ldr r1, =thirdText
	bl print_string
	vmov.f64 d0, #1.0
	vmov.f64 d1, #3.0
	vdiv.f64 d0, d0, d1
	bl print_fixed3

	ldr r1, =roundText
	bl print_string
	ldr r0, =halves
	vldmia r0, {s4-s5}              @ 2.5 and 3.5
	vcvtr.s32.f32 s4, s4            @ a tie goes to the even neighbour
	vcvtr.s32.f32 s5, s5
	vmov r0, s4
	bl print_decimal
	ldr r1, =roundText2
	bl print_string
	vmov r0, s5
	bl print_decimal
	ldr r1, =newline
	bl print_string

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0

@ print_fixed3(d0): write d0, not negative, to three places, then a newline.
print_fixed3:
	push {r4, r7, lr}
	ldr r0, =thousand
	vldr d1, [r0]
	vmul.f64 d0, d0, d1
	vcvtr.s32.f64 s0, d0            @ thousandths, to nearest
	vmov r4, s0
	mov r1, #1000
	udiv r0, r4, r1                 @ the whole part
	mls r4, r0, r1, r4              @ and the thousandths left over
	bl print_decimal
	sub sp, sp, #8                  @ ".xyz\n"
	mov r0, #'.'
	strb r0, [sp]
	mov r1, #100
	udiv r0, r4, r1
	mls r4, r0, r1, r4
	add r0, r0, #'0'
	strb r0, [sp, #1]
	mov r1, #10
	udiv r0, r4, r1
	mls r4, r0, r1, r4
	add r0, r0, #'0'
	strb r0, [sp, #2]
	add r0, r4, #'0'
	strb r0, [sp, #3]
	mov r0, #'\n'
	strb r0, [sp, #4]
	mov r0, #1              @ write(1, sp, 5)
	mov r1, sp
	mov r2, #5
	mov r7, #4
	svc #0
	add sp, sp, #8
	pop {r4, r7, pc}

@ print_string(r1): write the NUL-terminated string at r1.
print_string:
	push {r7, lr}
	mov r2, #0
1:	ldrb r0, [r1, r2]
	cmp r0, #0
	addne r2, r2, #1
	bne 1b
	mov r0, #1              @ write(1, r1, r2)
	mov r7, #4
	svc #0
	pop {r7, pc}

@ print_decimal(r0): write r0 in decimal, unsigned.
print_decimal:
	push {r4, r5, r7, lr}
	sub sp, sp, #16         @ room for 10 digits
	add r1, sp, #16         @ r1 walks back from the end of the buffer
	mov r4, #10
1:	udiv r5, r0, r4         @ r5 = r0 / 10
	mls r2, r5, r4, r0      @ r2 = r0 - r5 * 10, the lowest digit
	add r2, r2, #'0'
	strb r2, [r1, #-1]!
	movs r0, r5
	bne 1b
	mov r0, #1              @ fd 1
	add r2, sp, #16
	sub r2, r2, r1          @ length: from r1 to the end
	mov r7, #4              @ write(1, r1, r2)
	svc #0
	add sp, sp, #16
	pop {r4, r5, r7, pc}
