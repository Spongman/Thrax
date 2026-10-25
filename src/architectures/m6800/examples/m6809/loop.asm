; Loop Counter
; Print the integers 1 through 5.

; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldab #1
loop:
	ldaa #1
	swi
	pshs b
	ldab #10
	ldaa #2
	swi

	puls b
	incb
	cmpb #6
	bne loop
	ldaa #0
	swi
