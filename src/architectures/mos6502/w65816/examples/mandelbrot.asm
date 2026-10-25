; Mandelbrot Set
; CPU: WDC W65C816S (16-bit)
; FPU: none; signed 8.8 fixed point
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

.text
	clc
	xce
	rep #0x30
	ldx.w #0x7ffe
	txs
	ldx.w #0
	stz row
	lda.w #-320
	sta cy
row_loop:
	stz column
	lda.w #-512
	sta cx
pixel:
	stz x
	stz y
	stz iteration
iterate:
	lda x
	sta lhs
	sta rhs
	jsr multiply
	sta xx
	lda y
	sta lhs
	sta rhs
	jsr multiply
	sta yy
	clc
	adc xx
	cmp.w #1024
	bcs escaped
	lda x
	sta lhs
	lda y
	sta rhs
	jsr multiply
	asl a
	clc
	adc cy
	sta y
	lda xx
	sec
	sbc yy
	clc
	adc cx
	sta x
	inc iteration
	lda iteration
	cmp.w #16
	beq escaped
	jmp iterate
escaped:
	phx
	lda iteration
	asl a
	asl a
	tax
	lda palette, x
	sta color
	lda palette + 2, x
	sta color + 2
	plx
	lda color
	sta 0x8000, x
	lda color + 2
	sta 0x8002, x
	inx
	inx
	inx
	inx
	lda cx
	clc
	adc.w #20
	sta cx
	inc column
	lda column
	cmp.w #32
	beq row_done
	jmp pixel
row_done:
	lda cy
	clc
	adc.w #20
	sta cy
	inc row
	lda row
	cmp.w #32
	beq done
	jmp row_loop
done:
	stp
; signed Q8 multiply: absolute 16x16 -> 32, truncate /256, restore sign.
multiply:
	phx
	stz sign
	lda lhs
	bpl lhs_positive
	eor.w #0xffff
	inc a
	sta lhs
	inc sign
lhs_positive:
	lda rhs
	bpl rhs_positive
	eor.w #0xffff
	inc a
	sta rhs
	lda sign
	eor.w #1
	sta sign
rhs_positive:
	stz product_low
	stz product_high
	stz multiplicand_high
	ldx.w #16
mul_loop:
	lsr rhs
	bcc no_add
	lda product_low
	clc
	adc lhs
	sta product_low
	lda product_high
	adc multiplicand_high
	sta product_high
no_add:
	asl lhs
	rol multiplicand_high
	dex
	bne mul_loop
	lda product_low
	xba
	and.w #0x00ff
	sta quotient
	lda product_high
	xba
	and.w #0xff00
	ora quotient
	sta quotient
	lda sign
	beq positive_result
	lda quotient
	eor.w #0xffff
	inc a
	bra multiplication_done
positive_result:
	lda quotient
multiplication_done:
	plx
	rts
.org 0x100
row: .word 0
column: .word 0
cx: .word 0
cy: .word 0
x: .word 0
y: .word 0
xx: .word 0
yy: .word 0
iteration: .word 0
lhs: .word 0
rhs: .word 0
sign: .word 0
product_low: .word 0
product_high: .word 0
multiplicand_high: .word 0
quotient: .word 0
color: .long 0
.org 0x9200
palette:
.long 0x000030, 0x00104a, 0x001f66, 0x003080
.long 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
.long 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
.long 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff, 0
