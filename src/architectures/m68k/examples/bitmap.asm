; Bitmap Display
; Draw the common 32 by 32 red/blue gradient using long stores and postincrement.

.text
main:
	movea.l #$10000, a0
	moveq #0, d2
	moveq #31, d3
row:
	moveq #0, d4
	moveq #31, d5
pixel:
	move.l d2, d6
	or.l d4, d6
	move.l d6, (a0)+
	addq.l #8, d4
	dbra d5, pixel
	addi.l #$80000, d2
	dbra d3, row
	moveq #9, d0
	trap #15
