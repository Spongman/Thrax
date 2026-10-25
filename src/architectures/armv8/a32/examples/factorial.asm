@ Factorial
@ Compute 5! = 120 by recursion.

	.text
	.global _start
_start:
	mov r0, #5
	bl factorial
	bl print_decimal

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0

@ factorial(r0): r0! in r0.
factorial:
	cmp r0, #1
	movle r0, #1            @ 0! = 1! = 1
	bxle lr
	push {r0, lr}           @ keep n and the return address
	sub r0, r0, #1
	bl factorial            @ (n - 1)!
	pop {r1, lr}
	mul r0, r0, r1          @ n * (n - 1)!
	bx lr

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
