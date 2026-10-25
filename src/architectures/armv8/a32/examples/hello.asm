@ Hello, THRAX!
@ Print a string from the data section with the write system call.

	.data
message:	.ascii "Hello, THRAX!\n"
	.equ length, . - message

	.text
	.global _start
_start:
	mov r0, #1              @ fd 1: standard output
	movw r1, #:lower16:message  @ the address in two halves,
	movt r1, #:upper16:message  @ with no literal pool
	mov r2, #length         @ byte count
	mov r7, #4              @ write
	svc #0

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0
