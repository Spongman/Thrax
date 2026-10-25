; Hello, THRAX!
; Print a zero-terminated string using indexed addressing.

; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldx #message
loop:
	ldab 0, x
	beq done
	ldaa #2
	swi
	leax 1, x
	bra loop
done:
	ldaa #0
	swi

.data
message: .asciz "Hello, THRAX!\n"
	ldaa #0
	swi
