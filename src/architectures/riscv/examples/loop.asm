# Loop Counter
# Print the integers 1 through 5.

.text
_start:
	li t0, 1
	li t1, 6
loop:
	mv a0, t0
	li a7, 1
	ecall
	li a0, 10
	li a7, 11
	ecall
	addi t0, t0, 1
	blt t0, t1, loop
	ebreak
