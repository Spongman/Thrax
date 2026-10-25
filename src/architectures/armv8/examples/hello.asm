// Hello, THRAX!
// Print a string from the data section with the write system call.

	.data
message:	.ascii "Hello, THRAX!\n"
	.equ length, . - message

	.text
	.global _start
_start:
	mov x0, #1              // fd 1: standard output
	adrp x1, message        // the page holding message...
	add x1, x1, :lo12:message   // ...and its offset in it
	mov x2, #length         // byte count
	mov x8, #64             // write
	svc #0

	mov x0, #0              // status
	mov x8, #93             // exit
	svc #0
