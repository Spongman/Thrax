# Fibonacci
# Compute F(10) = 55 with a loop.

.text

main:
	addi $t0, $zero, 0      # fib(0) = 0
	addi $t1, $zero, 1      # fib(1) = 1
	addi $t2, $zero, 10     # counter = 10
	addi $t3, $zero, 2      # i = 2

loop:
	bgt $t3, $t2, done      # if i > 10, exit
	add $t4, $t0, $t1       # temp = fib(n - 2) + fib(n - 1)
	move $t0, $t1           # fib(n - 2) = fib(n - 1)
	move $t1, $t4           # fib(n - 1) = temp
	addi $t3, $t3, 1        # i++
	j loop

done:
	# Print result
	move $a0, $t1
	addi $v0, $zero, 1
	syscall

	# Exit
	addi $v0, $zero, 10
	syscall
