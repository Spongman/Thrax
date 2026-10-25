; Ackermann
; Nested BSR/RTS calls compute A(3, 3) = 61, printed with TRAP #15.

.text
main:
	moveq #3, d1
	moveq #3, d2
	bsr ackermann
	moveq #3, d0
	trap #15
	moveq #9, d0
	trap #15

ackermann:
	tst.l d1
	beq base
	tst.l d2
	beq zero
	move.l d1, -(sp)
	subq.l #1, d2
	bsr ackermann
	move.l d1, d2
	move.l (sp)+, d1
	subq.l #1, d1
	bra ackermann
zero:
	subq.l #1, d1
	moveq #1, d2
	bra ackermann
base:
	move.l d2, d1
	addq.l #1, d1
	rts
