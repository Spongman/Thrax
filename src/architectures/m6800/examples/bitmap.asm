; Bitmap Display
; Draw a 32 by 32 RGB gradient with explicit little-endian pixel bytes.

; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldx #0x4000
	clra
	staa <0x20
row_loop:
	clrb
column_loop:
	stab 0, x
	ldaa <0x20
	staa 2, x
	clra
	staa 1, x
	staa 3, x
	inx
	inx
	inx
	inx
	addb #8
	bne column_loop
	ldaa <0x20
	adda #8
	staa <0x20
	bne row_loop
	ldaa #0
	swi
