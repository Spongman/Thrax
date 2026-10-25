; Bitwise Operations
; Compare AND, OR and XOR using 12 and 10; prints 8, 14 and 6.

.data
results: dc.l 0, 0, 0

.text
main:
	moveq #12, d2
	moveq #10, d5
	move.l d2, d3
	move.l d2, d4
	and.l d5, d2
	or.l d5, d3
	eor.l d5, d4
	move.l d2, results
	move.l d3, results + 4
	move.l d4, results + 8
	move.l d2, d1
	moveq #3, d0
	trap #15
	moveq #10, d1
	moveq #6, d0
	trap #15
	move.l d3, d1
	moveq #3, d0
	trap #15
	moveq #10, d1
	moveq #6, d0
	trap #15
	move.l d4, d1
	moveq #3, d0
	trap #15
	moveq #10, d1
	moveq #6, d0
	trap #15
	moveq #9, d0
	trap #15
