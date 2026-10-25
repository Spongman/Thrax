; Loop Counter
; Print one through five, one number per line, and retain the last counter in RAM.

.data
counter: dc.l 0

.text
main:
	moveq #1, d2
	moveq #4, d3
loop:
	move.l d2, counter
	move.l d2, d1
	moveq #3, d0
	trap #15
	moveq #10, d1
	moveq #6, d0
	trap #15
	addq.l #1, d2
	dbra d3, loop
	moveq #9, d0
	trap #15
