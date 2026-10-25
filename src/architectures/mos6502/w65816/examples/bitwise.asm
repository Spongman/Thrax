; Bitwise Operations
; AND, OR and XOR on 12 and 10

.text
	clc
	xce
	rep #0x30
	ldx.w #0x7ffe
	txs
	lda.w #12
	and.w #10
	cop #1
	pha
	lda.w #10
	cop #2
	pla
	lda.w #12
	ora.w #10
	cop #1
	pha
	lda.w #10
	cop #2
	pla
	lda.w #12
	eor.w #10
	cop #1
	pha
	lda.w #10
	cop #2
	pla
	stp
