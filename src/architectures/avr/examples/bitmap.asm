; Bitmap Display
; Draw the common 32 by 32 red/blue gradient in SRAM at debugger address 0x10100

; Bitmap base: debugger 0x10100 = AVR SRAM address 0x100.

	ldi r26, 0
	ldi r27, 1
	clr r18
row:
	clr r17
pixel:
	mov r16, r17
	lsl r16
	lsl r16
	lsl r16
	st X+, r16
	clr r16
	st X+, r16
	mov r16, r18
	lsl r16
	lsl r16
	lsl r16
	st X+, r16
	clr r16
	st X+, r16
	inc r17
	cpi r17, 32
	brne pixel
	inc r18
	cpi r18, 32
	brne row
	break
