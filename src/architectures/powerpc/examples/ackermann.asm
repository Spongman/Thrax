# Ackermann
# Compute A(3, 3) by recursion and print 61.

.text
_start:
	li r3, 3
	li r4, 3
	bl ackermann
	li r0, 1
	sc
	li r0, 10
	sc

ackermann:
	cmpwi r3, 0
	beq base
	cmpwi r4, 0
	beq zero
	stwu r1, -16(r1)
	mflr r0
	stw r0, 12(r1)
	stw r3, 8(r1)
	addi r4, r4, -1
	bl ackermann
	mr r4, r3
	lwz r3, 8(r1)
	addi r3, r3, -1
	bl ackermann
	lwz r0, 12(r1)
	mtlr r0
	addi r1, r1, 16
	blr
zero:
	addi r3, r3, -1
	li r4, 1
	b ackermann
base:
	addi r3, r4, 1
	blr
