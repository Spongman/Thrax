# Ackermann
# Compute A(3, 3) = 61 by recursion; each call saves its return address on the stack.

.data
prompt:	.asciiz "A(3, 3) = "

.text

main:
	li $v0, 4               # print the label
	la $a0, prompt
	syscall

	li $a0, 3               # m = 3
	li $a1, 3               # n = 3
	jal ackermann

	move $a0, $v0           # print the result
	li $v0, 1
	syscall

	li $v0, 10              # exit
	syscall

# ackermann($a0 = m, $a1 = n): A(m, n) in $v0.
#   A(0, n) = n + 1
#   A(m, 0) = A(m - 1, 1)
#   A(m, n) = A(m - 1, A(m, n - 1))
ackermann:
	addi $sp, $sp, -12      # frame: return address, m, n
	sw $ra, 0($sp)
	sw $a0, 4($sp)
	sw $a1, 8($sp)

	bne $a0, $zero, m_positive
	addi $v0, $a1, 1        # m = 0: A(0, n) = n + 1
	j ackermann_return

m_positive:
	bne $a1, $zero, both_positive
	addi $a0, $a0, -1       # n = 0: A(m, 0) = A(m - 1, 1)
	li $a1, 1
	jal ackermann
	j ackermann_return

both_positive:
	addi $a1, $a1, -1       # inner call: A(m, n - 1)
	jal ackermann

	lw $a0, 4($sp)          # outer call: A(m - 1, inner)
	addi $a0, $a0, -1
	move $a1, $v0
	jal ackermann

ackermann_return:
	lw $ra, 0($sp)
	addi $sp, $sp, 12
	jr $ra
