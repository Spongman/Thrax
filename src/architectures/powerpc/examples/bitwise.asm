# Bitwise Operations
# Print the AND, OR and XOR of 12 and 10: 8, 14 and 6.

.text
_start:
	li r4, 12
	li r5, 10
	and r3, r4, r5
	li r0, 1
	sc
	li r3, 32
	li r0, 11
	sc
	or r3, r4, r5
	li r0, 1
	sc
	li r3, 32
	li r0, 11
	sc
	xor r3, r4, r5
	li r0, 1
	sc
	li r0, 10
	sc
