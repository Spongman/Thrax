; Sum of Numbers
; Native 16-bit addition

.text
	clc
	xce
	rep #0x30
	ldx.w #0x7ffe
	txs
	lda.w #3
	clc
	adc.w #5
	cop #1
	pha
	lda.w #10
	cop #2
	pla
	stp
