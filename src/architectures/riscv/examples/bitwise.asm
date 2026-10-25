# Bitwise Operations
# Print the AND, OR and XOR of 12 and 10: 8, 14 and 6.

.text
_start:
	li t0, 12
	li t1, 10
	and a0, t0, t1
	call print_line
	or a0, t0, t1
	call print_line
	xor a0, t0, t1
	call print_line
	ebreak

print_line:
	li a7, 1
	ecall
	li a0, 10
	li a7, 11
	ecall
	ret
