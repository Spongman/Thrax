; Factorial
; Compute 5! using the native 68HC11 MUL instruction.

; The 68HC11 MUL instruction produces D=A:B and preserves Z.
; Host monitor ABI (not bare-metal I/O): SWI with A = 0 exit, 1 print signed B, 2 character B, 3 read signed B.
.text
	ldab #5
	jsr factorial
	ldaa #1
	swi
	clra
	swi

factorial:
	stab counter
	ldab #1
loop:
	ldaa counter
	mul
	dec counter
	bne loop
	rts

.data
counter: .byte 0
