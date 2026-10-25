# Fibonacci
# Compute F(10) iteratively and print 55.

.text
_start:
	li r3, 0
	li r4, 1
	li r5, 10
loop:
	add r6, r3, r4
	mr r3, r4
	mr r4, r6
	addi r5, r5, -1
	cmpwi r5, 0
	bne loop
	li r0, 1
	sc
	li r0, 10
	sc
