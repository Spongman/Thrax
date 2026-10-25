; 68010: RTD and Arguments
; RTD restores the caller PC and removes one long stack argument.

.text
main:
	move.l #42, -(sp)
	bsr printArgument
	moveq #9, d0
	trap #15

printArgument:
	move.l 4(sp), d1
	moveq #3, d0
	trap #15
	rtd #4
