; Bitwise Operations
; Combine 12 and 10: AND in r18, OR in r19, XOR in r20

	ldi r16, 12
	ldi r17, 10
	mov r18, r16
	and r18, r17
	mov r19, r16
	or r19, r17
	mov r20, r16
	eor r20, r17
	break
