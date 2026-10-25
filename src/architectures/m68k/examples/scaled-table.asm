; 68020: Scaled Table Index
; Brief scaled indexing selects a long table entry; EXTB sign-extends a byte.

.data
table: dc.l 10, 20, 30, 40

.text
main:
	lea table, a0
	moveq #2, d1
	move.l 0(a0, d1.l*4), d1
	move.b #$80, d2
	extb.l d2
	moveq #3, d0
	trap #15
	moveq #9, d0
	trap #15
