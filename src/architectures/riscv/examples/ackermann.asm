# Ackermann
# Compute A(3, 3) by recursion and print 61.

.text
_start:
	li a0, 3
	li a1, 3
	call ackermann
	li a7, 1
	ecall
	ebreak

ackermann:
	beqz a0, base
	beqz a1, zero
	addi sp, sp, -16
	sw ra, 12(sp)
	sw a0, 8(sp)
	addi a1, a1, -1
	call ackermann
	mv a1, a0
	lw a0, 8(sp)
	addi a0, a0, -1
	call ackermann
	lw ra, 12(sp)
	addi sp, sp, 16
	ret
zero:
	addi a0, a0, -1
	li a1, 1
	j ackermann
base:
	addi a0, a1, 1
	ret
