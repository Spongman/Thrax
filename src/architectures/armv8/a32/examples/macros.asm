@ Macros
@ Define once, use many times: macros expand in place, so a use costs no call and return.

	.equ SYS_WRITE, 4
	.equ SYS_EXIT, 1

	.macro print text, length
	mov r0, #1
	ldr r1, =\text
	mov r2, #\length
	mov r7, #SYS_WRITE
	svc #0
	.endm

@ A numeric label such as 1: can be defined again in every expansion:
@ 1b names the nearest one before, 1f the next one after.
	.macro count_to limit
	mov r4, #1
1:	add r0, r4, #'0'        @ the digit
	bl print_char
	add r4, r4, #1
	cmp r4, #\limit
	ble 1b
	.endm

	.macro exit status=0
	mov r0, #\status
	mov r7, #SYS_EXIT
	svc #0
	.endm

	.data
banner:		.ascii "counting: "
newline:	.ascii "\n"

	.text
	.global _start
_start:
	print banner, 10

	count_to 5
	print newline, 1

	count_to 3
	print newline, 1

	exit

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
