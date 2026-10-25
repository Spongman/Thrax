# Factorial
# Compute 5! and print 120.

.text
_start:
	li r3, 5
	bl factorial
	li r0, 1
	sc
	li r0, 10
	sc

factorial:
	mr r4, r3
	li r3, 1
loop:
	cmpwi r4, 0
	beq done
	mullw r3, r3, r4
	addi r4, r4, -1
	b loop
done:
	blr
