@ Bitwise Operations
@ Print 12 AND 10, 12 OR 10 and 12 EOR 10.

	.text
_start:
	mov r4, #12             @ 12 = 0b1100
	mov r5, #10             @ 10 = 0b1010

	and r0, r4, r5          @ 12 & 10 = 8
	bl print_decimal
	mov r0, #' '
	swi OS_WriteC

	orr r0, r4, r5          @ 12 | 10 = 14
	bl print_decimal
	mov r0, #' '
	swi OS_WriteC

	eor r0, r4, r5          @ 12 ^ 10 = 6
	bl print_decimal
	swi OS_Exit

@ print_decimal(r0): write r0 >= 0 in decimal, leading digits first.
print_decimal:
	stmfd sp!, {r0-r3, lr}
	mov r1, #10
	bl divide               @ r0 <- n / 10, r1 <- n % 10
	cmp r0, #0
	blne print_decimal      @ the leading digits, if any
	add r0, r1, #'0'
	swi OS_WriteC
	ldmfd sp!, {r0-r3, pc}

@ divide(r0, r1): r0 = r0 / r1 and r1 = r0 % r1, unsigned, by shift and subtract.
@ The ARM2 has no divide instruction.  Uses r2 and r3.
divide:
	mov r2, #0              @ quotient
	mov r3, #1              @ the quotient bit the divisor stands for
1:	cmp r1, r0              @ shift the divisor up past the dividend
	movls r1, r1, lsl #1
	movls r3, r3, lsl #1
	bls 1b
2:	cmp r0, r1              @ then back down, subtracting where it fits
	subcs r0, r0, r1
	orrcs r2, r2, r3
	movs r3, r3, lsr #1
	movne r1, r1, lsr #1
	bne 2b
	mov r1, r0
	mov r0, r2
	mov pc, lr
