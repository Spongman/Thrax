# Factorial
# Compute 5! = 120 with a loop.

.text

main:
	addi $t0, $zero, 5      # n = 5
	addi $t1, $zero, 1      # result = 1

loop:
	beq $t0, $zero, done    # if n == 0, exit loop
	mul $t1, $t1, $t0       # result = result * n
	addi $t0, $t0, -1       # n--
	j loop

done:
	# Print result
	move $a0, $t1
	addi $v0, $zero, 1
	syscall

	# Exit
	addi $v0, $zero, 10
	syscall
