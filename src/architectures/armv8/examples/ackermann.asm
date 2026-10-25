// Ackermann
// Compute A(3, 3) = 61 by recursion; watch the Call Stack panel grow and shrink.

	.data
label:	.asciz "A(3, 3) = "

	.text
	.global _start
_start:
	ldr x0, =label
	bl print_string
	mov x0, #3              // m
	mov x1, #3              // n
	bl ackermann
	bl print_decimal

	mov x0, #0              // status
	mov x8, #93             // exit
	svc #0

// ackermann(x0 = m, x1 = n): A(m, n) in x0.
//   A(0, n) = n + 1
//   A(m, 0) = A(m - 1, 1)
//   A(m, n) = A(m - 1, A(m, n - 1))
ackermann:
	cbnz x0, 1f
	add x0, x1, #1          // A(0, n) = n + 1
	ret
1:	stp x29, x30, [sp, #-32]!   // a frame, with a slot for m
	mov x29, sp
	cbnz x1, 2f
	sub x0, x0, #1          // A(m, 0) = A(m - 1, 1)
	mov x1, #1
	bl ackermann
	b 3f
2:	str x0, [sp, #16]       // keep m
	sub x1, x1, #1
	bl ackermann            // A(m, n - 1)
	mov x1, x0
	ldr x0, [sp, #16]
	sub x0, x0, #1
	bl ackermann            // A(m - 1, A(m, n - 1))
3:	ldp x29, x30, [sp], #32
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
