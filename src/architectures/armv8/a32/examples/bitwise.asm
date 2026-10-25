@ Bitwise Operations
@ Print 12 AND 10, 12 OR 10 and 12 XOR 10.

	.text
	.global _start
_start:
	mov r4, #12             @ 0b1100
	mov r5, #10             @ 0b1010

	and r0, r4, r5          @ 12 & 10 = 8
	bl print_decimal
	mov r0, #' '
	bl print_char

	orr r0, r4, r5          @ 12 | 10 = 14
	bl print_decimal
	mov r0, #' '
	bl print_char

	eor r0, r4, r5          @ 12 ^ 10 = 6
	bl print_decimal

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0

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

@ print_char(r0): write one character.
print_char:
	push {r0, r7}           @ the character, on the stack
	mov r0, #1              @ fd 1: standard output
	mov r1, sp              @ buffer: the low byte of the pushed r0
	mov r2, #1              @ one byte
	mov r7, #4              @ write
	svc #0
	pop {r0, r7}
	bx lr
