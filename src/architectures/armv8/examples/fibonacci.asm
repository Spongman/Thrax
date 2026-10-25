// Fibonacci
// Compute F(10) = 55 with a loop.

	.text
	.global _start
_start:
	mov x0, #10             // n
	mov x1, #0              // F(0)
	mov x2, #1              // F(1)
1:	add x3, x1, x2          // the next number
	mov x1, x2
	mov x2, x3
	subs x0, x0, #1
	b.ne 1b

	mov x0, x1              // F(10)
	bl print_decimal

	mov x0, #0              // status
	mov x8, #93             // exit
	svc #0

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
