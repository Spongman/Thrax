@ Interactive Input
@ Read a line into a buffer, then print it.

	.data
buffer:	.space 64

	.text
	.global _start
_start:
	mov r0, #0              @ fd 0: standard input
	ldr r1, =buffer
	mov r2, #64             @ at most 64 bytes
	mov r7, #3              @ read: waits for a line, returns its length
	svc #0

	mov r2, r0              @ write back as many bytes as were read
	mov r0, #1              @ fd 1: standard output
	ldr r1, =buffer
	mov r7, #4              @ write
	svc #0

	mov r0, #0              @ status
	mov r7, #1              @ exit
	svc #0
