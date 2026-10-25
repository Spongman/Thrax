// Sum of Numbers
// Compute 5 + 3 = 8 and print it.

	.text
	.global _start
_start:
	mov x19, #5             // x19 = 5
	mov x20, #3             // x20 = 3
	add x0, x19, x20        // x0 = x19 + x20 = 8

	bl print_decimal           // print the result
	mov w0, #'\n'
	bl print_char           // and a newline

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
