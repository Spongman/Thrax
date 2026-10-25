@ Bit Fields
@ Use instructions ARMv8 has and the ARM2 had not, on r4 = 0x12345678.

	.text
	.global _start
_start:
	movw r4, #0x5678
	movt r4, #0x1234        @ r4 = 0x12345678

	ubfx r0, r4, #8, #8     @ bits 8-15: 0x56 = 86
	bl show
	clz r0, r4              @ leading zeros: 3
	bl show
	rev r0, r4              @ bytes reversed: 0x78563412
	bl show
	mov r0, #0
	bfi r0, r4, #4, #8      @ the low byte, 0x78, into bits 4-11: 0x780
	bl show
	mov r5, #0xF0
	sxtb r0, r5             @ 0xF0 sign-extended is -16...
	rsb r0, r0, #0          @ ...so this is 16
	bl print_decimal
	mov r0, #'\n'
	bl print_char

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0

@ show(r0): print r0 and a space.
show:
	push {r4, lr}
	bl print_decimal
	mov r0, #' '
	bl print_char
	pop {r4, pc}

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
