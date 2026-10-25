; Loop Counter
; Store 1 through 5 in SRAM at debugger 0x10100

	ldi r26, 0
	ldi r27, 1
	ldi r16, 1
	ldi r17, 5
loop:
	st X+, r16
	inc r16
	dec r17
	brne loop
	break
