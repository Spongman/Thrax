; Fibonacci
; Calculate the tenth Fibonacci number.

; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldaa #0
	staa <0x20
	ldab #1
	ldaa #10
	staa <0x21
loop:
	ldaa <0x20
	stab <0x20
	aba
	tab
	ldaa <0x21
	deca
	staa <0x21
	bne loop
	ldab <0x20
	ldaa #1
	swi

	ldaa #0
	swi
