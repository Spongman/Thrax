@ Ackermann
@ Compute A(3, 3) = 61 by recursion; each call saves n and lr on the stack, so watch sp.

	.text
_start:
	swi OS_WriteS           @ the label, written from just after the SWI
	.asciz "A(3, 3) = "
	.align 2
	mov r0, #3              @ m
	mov r1, #3              @ n
	bl ackermann
	bl print_decimal
	swi OS_Exit

@ ackermann(r0 = m, r1 = n): A(m, n) in r0.
@   A(0, n) = n + 1
@   A(m, 0) = A(m - 1, 1)
@   A(m, n) = A(m - 1, A(m, n - 1))
ackermann:
	stmfd sp!, {r1, lr}
	cmp r0, #0
	addeq r0, r1, #1        @ m = 0: A(0, n) = n + 1
	beq 9f
	cmp r1, #0
	bne 1f
	sub r0, r0, #1          @ n = 0: A(m, 0) = A(m - 1, 1)
	mov r1, #1
	bl ackermann
	b 9f
1:	stmfd sp!, {r0}         @ keep m for the outer call
	sub r1, r1, #1          @ inner call: A(m, n - 1)
	bl ackermann
	mov r1, r0
	ldmfd sp!, {r0}
	sub r0, r0, #1          @ outer call: A(m - 1, inner)
	bl ackermann
9:	ldmfd sp!, {r1, pc}

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
