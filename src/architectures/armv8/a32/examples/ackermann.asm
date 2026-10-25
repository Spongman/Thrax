@ Ackermann
@ Compute A(3, 3) = 61 by recursion; watch the Call Stack panel grow and shrink.

	.data
label:	.asciz "A(3, 3) = "

	.text
	.global _start
_start:
	ldr r0, =label
	bl print_string
	mov r0, #3              @ m
	mov r1, #3              @ n
	bl ackermann
	bl print_decimal

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0

@ ackermann(r0 = m, r1 = n): A(m, n) in r0.
@   A(0, n) = n + 1
@   A(m, 0) = A(m - 1, 1)
@   A(m, n) = A(m - 1, A(m, n - 1))
ackermann:
	cmp r0, #0
	addeq r0, r1, #1        @ A(0, n) = n + 1
	bxeq lr
	push {r4, lr}           @ a frame, with r4 to keep m in
	cmp r1, #0
	bne 1f
	sub r0, r0, #1          @ A(m, 0) = A(m - 1, 1)
	mov r1, #1
	bl ackermann
	pop {r4, pc}
1:	mov r4, r0              @ keep m
	sub r1, r1, #1
	bl ackermann            @ A(m, n - 1)
	mov r1, r0
	sub r0, r4, #1
	bl ackermann            @ A(m - 1, A(m, n - 1))
	pop {r4, pc}

@ print_string(r0): write the zero-terminated string at r0.
print_string:
	push {r7, lr}
	mov r1, r0              @ buffer
	mov r2, #0              @ length so far
1:	ldrb r3, [r1, r2]
	cmp r3, #0              @ stop at the terminating zero
	addne r2, r2, #1
	bne 1b
	mov r0, #1              @ fd 1
	mov r7, #4              @ write(1, r1, r2)
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
