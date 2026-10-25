; Ackermann
; Compute A(3, 3) = 61 with recursive JSR/RTS and a real hardware stack.

; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldaa #3
	ldab #3
	jsr ackermann
	ldaa #1
	swi

	ldaa #0
	swi

ackermann:
	tsta
	bne ack_nonzero
	incb
	rts
ack_nonzero:
	tstb
	bne ack_recursive
	deca
	ldab #1
	jsr ackermann
	rts
ack_recursive:
	pshs a
	decb
	jsr ackermann
	puls a
	deca
	jsr ackermann
	rts
	ldaa #0
	swi
