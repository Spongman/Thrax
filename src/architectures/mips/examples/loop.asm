# Loop Counter
# Print the numbers 1 through 5.

.text

main:
	addi $t0, $zero, 1      # counter = 1

loop:
	addi $t1, $zero, 6      # load 6 for comparison
	beq $t0, $t1, done      # if counter == 6, exit

	# Print counter
	move $a0, $t0
	addi $v0, $zero, 1
	syscall

	# Print space
	addi $a0, $zero, 32     # ASCII space
	addi $v0, $zero, 11
	syscall

	# Increment and loop
	addi $t0, $t0, 1
	j loop

done:
	# Print newline
	addi $a0, $zero, 10
	addi $v0, $zero, 11
	syscall

	# Exit
	addi $v0, $zero, 10
	syscall
