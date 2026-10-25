; Stack and Registers
; Save registers, change values, restore them and rewind the stack.

.text
main:
	moveq #42, d1
	moveq #-7, d2
	movem.l d1-d2/a0, -(sp)
	clr.l d1
	clr.l d2
	movem.l (sp)+, d1-d2/a0
	moveq #3, d0
	trap #15
	moveq #9, d0
	trap #15
