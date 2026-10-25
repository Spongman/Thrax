; Bitwise Operations
; AND, OR and XOR on 12 and 10.

; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldab #12
	andb #10
	ldaa #1
	swi

	ldab #10
	ldaa #2
	swi

	ldab #12
	orab #10
	ldaa #1
	swi

	ldab #10
	ldaa #2
	swi

	ldab #12
	eorb #10
	ldaa #1
	swi

	ldaa #0
	swi
