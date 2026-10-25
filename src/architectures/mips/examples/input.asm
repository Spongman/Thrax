# Interactive Input
# Read a line into a buffer, then print it.

.data
buffer: .space 64

.text
main:
	la $a0, buffer
	li $a1, 64
	li $v0, 8
	syscall

	la $a0, buffer
	li $v0, 4
	syscall

	li $v0, 10
	syscall
