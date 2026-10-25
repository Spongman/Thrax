// Interactive Input
// Read a line into a buffer, then print it.

	.data
buffer:	.space 64

	.text
	.global _start
_start:
	mov x0, #0              // fd 0: standard input
	ldr x1, =buffer
	mov x2, #64             // at most 64 bytes
	mov x8, #63             // read: waits for a line, returns its length
	svc #0

	mov x2, x0              // write back as many bytes as were read
	mov x0, #1              // fd 1: standard output
	ldr x1, =buffer
	mov x8, #64             // write
	svc #0

	mov x0, #0              // status
	mov x8, #93             // exit
	svc #0
