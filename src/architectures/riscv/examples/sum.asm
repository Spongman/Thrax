# Sum of Numbers
# Add two numbers and print the sum, 8.

.text
_start:
	li a0, 5
	li t0, 3
	add a0, a0, t0
	li a7, 1
	ecall
	ebreak
