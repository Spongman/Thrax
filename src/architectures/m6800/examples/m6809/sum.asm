; Sum of Numbers
; Add 3 and 5 using the B accumulator.

; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldab #3
	addb #5
	ldaa #1
	swi

	ldaa #0
	swi
