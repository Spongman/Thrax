// Macros
// Define once, use many times: macros expand in place, so a use costs no call and return.

	.equ SYS_WRITE, 64
	.equ SYS_EXIT, 93

	.macro print text, length
	mov x0, #1
	ldr x1, =\text
	mov x2, #\length
	mov x8, #SYS_WRITE
	svc #0
	.endm

// A numeric label such as 1: can be defined again in every expansion:
// 1b names the nearest one before, 1f the next one after.
	.macro count_to limit
	mov x19, #1
1:	add w0, w19, #'0'       // the digit
	bl print_char
	add x19, x19, #1
	cmp x19, #\limit
	b.le 1b
	.endm

	.macro exit status=0
	mov x0, #\status
	mov x8, #SYS_EXIT
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
