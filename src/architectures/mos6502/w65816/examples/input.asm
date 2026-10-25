; Interactive Input
; Read and echo a signed integer

.text
	clc
	xce
	rep #0x30
	ldx.w #0x7ffe
	txs
	cop #4
	cop #1
	pha
	lda.w #10
	cop #2
	pla
	stp
