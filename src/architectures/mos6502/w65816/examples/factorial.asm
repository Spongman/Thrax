; Factorial
; Compute 5! with native repeated-addition multiplication

.text
	clc
	xce
	rep #0x30
	ldx.w #0x7ffe
	txs
	lda.w #1
	sta result
	ldx.w #5
loop:
	stx factor_value
	lda.w #0
	ldy factor_value
multiply_loop:
	clc
	adc result
	dey
	bne multiply_loop
	sta result
	dex
	bne loop
	cop #1
	pha
	lda.w #10
	cop #2
	pla
	stp
.org 0x100
result: .word 0
factor_value: .word 0
