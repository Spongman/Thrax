; Fibonacci
; Compute the 10th Fibonacci number with 16-bit registers

.text
	clc
	xce
	rep #0x30
	ldx.w #0x7ffe
	txs
	lda.w #0
	sta first
	lda.w #1
	sta second
	ldx.w #10
loop:
	lda first
	clc
	adc second
	pha
	lda second
	sta first
	pla
	sta second
	dex
	bne loop
	lda first
	cop #1
	pha
	lda.w #10
	cop #2
	pla
	stp
.org 0x100
first: .word 0
second: .word 0
