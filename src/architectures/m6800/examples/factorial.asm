; Factorial
; Calculate 5! by repeated addition with native 8-bit instructions.

; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldab #1
	ldaa #5
	staa <0x20
loop:
	ldaa <0x20
	stab <0x21
	clrb
product_loop:
	addb <0x21
	deca
	bne product_loop
	ldaa <0x20
	deca
	staa <0x20
	bne loop
	ldaa #1
	swi

	ldaa #0
	swi
