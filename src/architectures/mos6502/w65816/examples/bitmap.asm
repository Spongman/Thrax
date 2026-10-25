; Bitmap Display
; 32 by 32 RGB gradient in RGB32 little-endian format

.text
	clc
	xce
	rep #0x30
	ldx.w #0x7ffe
	txs
	ldx.w #0
	stz row
row_loop:
	stz column
pixel:
	lda column
	asl a
	asl a
	asl a
	sta 0x8000, x
	lda row
	asl a
	asl a
	asl a
	sta 0x8002, x
	inx
	inx
	inx
	inx
	inc column
	lda column
	cmp.w #32
	bne pixel
	inc row
	lda row
	cmp.w #32
	bne row_loop
	stp
.org 0x100
row: .word 0
column: .word 0
