; Interactive Input
; Read a signed integer into D1, store it, and echo it through educational TRAP #15.

.data
result: dc.l 0

.text
main:
	moveq #5, d0
	trap #15
	move.l d1, result
	moveq #3, d0
	trap #15
	moveq #9, d0
	trap #15
