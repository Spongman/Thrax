; Subroutine and SRAM
; Harvard data, pointer addressing, stack and a subroutine

.dseg
value: .byte 41
.cseg
	ldi r26, lo8(value)
	ldi r27, hi8(value)
	ld r16, X
	rcall increment
	st X, r16
	break
increment:
	push r17
	ldi r17, 1
	add r16, r17
	pop r17
	ret
