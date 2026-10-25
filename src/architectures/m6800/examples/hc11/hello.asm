; Hello, THRAX!
; Print a NUL-terminated string using native Y-indexed loads.

; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldy #message
loop:
	ldab 0, y
	tstb
	beq done
	ldaa #2
	swi
	iny
	bra loop
done:
	clra
	swi

.data
message: .asciz "Hello, THRAX!\n"
