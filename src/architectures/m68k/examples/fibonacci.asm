; Fibonacci
; Compute the tenth Fibonacci number with a DBRA loop; prints 55.

.data
result: dc.l 0

.text
main:
	moveq #0, d2
	moveq #1, d3
	moveq #9, d4
loop:
	move.l d2, d5
	add.l d3, d5
	move.l d3, d2
	move.l d5, d3
	dbra d4, loop
	move.l d2, result
	move.l d2, d1
	moveq #3, d0
	trap #15
	moveq #9, d0
	trap #15
