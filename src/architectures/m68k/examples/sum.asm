; Sum of Numbers
; Add 5 and 3, store the result, then print 8.

.data
result: dc.l 0

.text
main:
	moveq #5, d1
	moveq #3, d2
	add.l d2, d1
	move.l d1, result
	moveq #3, d0
	trap #15
	moveq #9, d0
	trap #15
