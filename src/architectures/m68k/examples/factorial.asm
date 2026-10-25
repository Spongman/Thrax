; Factorial
; Word multiplication, BSR/RTS and a DBRA loop; prints 120.

.text
main:
	moveq #5, d1
	bsr factorial
	moveq #3, d0
	trap #15
	moveq #9, d0
	trap #15

factorial:
	move.w d1, d2
	moveq #1, d1
	subq.w #1, d2
loop:
	move.w d2, d3
	addq.w #1, d3
	mulu.w d3, d1
	dbra d2, loop
	rts
