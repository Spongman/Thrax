; Loop Counter
; Print integers 1 through 5

.text
	clc
	xce
	rep #0x30
	ldx.w #0x7ffe
	txs
	ldx.w #1
loop:
	txa
	cop #1
	pha
	lda.w #10
	cop #2
	pla
	inx
	cpx.w #6
	bne loop
	stp
