# Sum of Numbers
# Compute 5 + 3 = 8 and print it.

.text

main:
	# Load values
	addi $t0, $zero, 5      # $t0 = 5
	addi $t1, $zero, 3      # $t1 = 3

	# Add them
	add $t2, $t0, $t1       # $t2 = $t0 + $t1 = 8

	# Print result
	move $a0, $t2           # $a0 = $t2 (argument for syscall)
	addi $v0, $zero, 1      # $v0 = 1 (print integer syscall)
	syscall

	# Print newline
	addi $a0, $zero, 10     # ASCII code for newline
	addi $v0, $zero, 11     # $v0 = 11 (print character syscall)
	syscall

	# Exit
	addi $v0, $zero, 10     # $v0 = 10 (exit syscall)
	syscall
