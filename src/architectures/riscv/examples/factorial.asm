# Factorial
# Compute 5! and print 120.

.text
_start:
	li a0, 5
	call factorial
	li a7, 1
	ecall
	li a7, 10
	ecall

factorial:
	mv t0, a0
	li a0, 1
loop:
	beqz t0, done
	mul a0, a0, t0
	addi t0, t0, -1
	j loop
done:
	ret
