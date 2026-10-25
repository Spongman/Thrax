# Hello, THRAX!
# Print a string from the data segment with the print-string syscall.

.data
message: .asciiz "Hello, THRAX!\n"

.text
main:
	la $a0, message
	li $v0, 4
	syscall

	li $v0, 10
	syscall
