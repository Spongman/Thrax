; Ackermann
; Recursive JSR/RTS computes A(3, 3) = 61

.text
	clc
	xce
	rep #0x30
	ldx.w #0x7ffe
	txs
	lda.w #3
	ldx.w #3
	jsr ackermann
	cop #1
	pha
	lda.w #10
	cop #2
	pla
	stp
ackermann:
	cmp.w #0
	bne nonzero
	txa
	inc a
	rts
nonzero:
	cpx.w #0
	bne recurse
	dec a
	ldx.w #1
	jsr ackermann
	rts
recurse:
	pha
	dex
	jsr ackermann
	tax
	pla
	dec a
	jsr ackermann
	rts
