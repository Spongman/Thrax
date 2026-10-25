; Sum of Numbers
; Add 3 and 5; the result 8 remains in r17

; Code labels and .org are BYTE addresses in this dialect.

	ldi r16, 3
	ldi r17, 5
	add r17, r16
	break
