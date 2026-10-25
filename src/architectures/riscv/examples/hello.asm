# Hello, THRAX!
# Print a greeting with the console service.

.text
.globl _start
_start:
	la a0, message
	li a7, 4
	ecall
	li a7, 10
	ecall

.data
message: .asciz "Hello, THRAX!\n"
