# Bitwise Operations
# Print 12 AND 10, 12 OR 10 and 12 XOR 10.

.text

main:
	addi $t0, $zero, 12     # $t0 = 12 (binary: 1100)
	addi $t1, $zero, 10     # $t1 = 10 (binary: 1010)

	# AND operation
	and $t2, $t0, $t1       # $t2 = 12 & 10 = 8
	move $a0, $t2
	addi $v0, $zero, 1
	syscall

	addi $a0, $zero, 32
	addi $v0, $zero, 11
	syscall

	# OR operation
	or $t2, $t0, $t1        # $t2 = 12 | 10 = 14
	move $a0, $t2
	addi $v0, $zero, 1
	syscall

	addi $a0, $zero, 32
	addi $v0, $zero, 11
	syscall

	# XOR operation
	xor $t2, $t0, $t1       # $t2 = 12 ^ 10 = 6
	move $a0, $t2
	addi $v0, $zero, 1
	syscall

	# Exit
	addi $v0, $zero, 10
	syscall
