# Loop Counter
# Print the integers 1 through 5.

.text
_start:
	li r5, 1
loop:
	mr r3, r5
	li r0, 1
	sc
	li r3, 32
	li r0, 11
	sc
	addi r5, r5, 1
	cmpwi r5, 6
	blt loop
	li r0, 10
	sc
