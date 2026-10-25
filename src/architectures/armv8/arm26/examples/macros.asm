@ Macros
@ Define once, use many times: macros expand in place, so a use costs no call and return.

	.equ FIRST, 5           @ symbols name constants
	.equ SECOND, 3

	.macro print text
	adr r0, \text
	swi OS_Write0
	.endm

@ A numeric label such as 1: can be defined again in every expansion:
@ 1b names the nearest one before, 1f the next one after.
	.macro count_to limit
	mov r4, #0
1:	add r4, r4, #1
	mov r0, r4
	bl print_decimal
	cmp r4, \limit
	bne 1b
	.endm

	.text
_start:
	print banner
	mov r5, #FIRST
	count_to r5
	print newline
	mov r5, #SECOND
	count_to r5
	print newline
	swi OS_Exit

banner:	.asciz "counting: "
newline:	.asciz "\n"
	.align 2

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
