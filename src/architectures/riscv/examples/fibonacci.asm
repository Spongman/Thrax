# Fibonacci
# Compute F(10) iteratively and print 55.

.text
_start:
	li a0, 0
	li t0, 1
	li t1, 10
loop:
	add t2, a0, t0
	mv a0, t0
	mv t0, t2
	addi t1, t1, -1
	bnez t1, loop
	li a7, 1
	ecall
	ebreak
