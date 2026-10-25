@ Fibonacci
@ Compute F(10) = 55 with a loop.

	.text
_start:
	mov r1, #0              @ fib(0) = 0
	mov r2, #1              @ fib(1) = 1
	mov r3, #2              @ i = 2
loop:
	cmp r3, #10
	bgt done                @ if i > 10, exit
	add r4, r1, r2          @ temp = fib(n - 2) + fib(n - 1)
	mov r1, r2              @ fib(n - 2) = fib(n - 1)
	mov r2, r4              @ fib(n - 1) = temp
	add r3, r3, #1          @ i++
	b loop

done:
	mov r0, r2
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
