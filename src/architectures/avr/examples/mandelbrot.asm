; Mandelbrot Set
; CPU: Atmel AVR8 teaching core
; FPU: none; signed 8.8 fixed point
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; Step 20/256, as on the 6502 port.
; Bitmap base 0x10100 in the debugger is SRAM address 0x100 on the AVR.
; State: r3:r2=cr, r5:r4=ci, r7:r6=zr, r9:r8=zi, r11:r10=zr2,
; r13:r12=zi2, r30=iterations. r25 is kept zero, X is the pixel cursor.

.equ MAXITER, 16
	clr r25
	ldi r26, 0
	ldi r27, 1
	ldi r16, 0xC0
	ldi r17, 0xFE           ; -320
	mov r4, r16
	mov r5, r17
row:
	clr r2
	ldi r16, 0xFE           ; -512
	mov r3, r16
column:
	clr r6
	clr r7
	clr r8
	clr r9
	clr r30
iterate:
	mov r16, r6
	mov r17, r7
	mov r18, r6
	mov r19, r7
	rcall multiply
	mov r10, r16
	mov r11, r17
	mov r16, r8
	mov r17, r9
	mov r18, r8
	mov r19, r9
	rcall multiply
	mov r12, r16
	mov r13, r17
	add r16, r10
	adc r17, r11
	cpi r17, 4              ; |z| squared >= 4.0
	brlo continue_point
	rjmp escaped
continue_point:
	mov r16, r6
	mov r17, r7
	mov r18, r8
	mov r19, r9
	rcall multiply
	lsl r16
	rol r17
	add r16, r4
	adc r17, r5
	mov r8, r16
	mov r9, r17
	mov r6, r10
	mov r7, r11
	sub r6, r12
	sbc r7, r13
	add r6, r2
	adc r7, r3
	inc r30
	cpi r30, MAXITER
	breq inside
	rjmp iterate
inside:
escaped:
	mov r16, r30
	lsl r16
	lsl r16
	ldi r30, lo8(palette)
	ldi r31, hi8(palette)
	add r30, r16
	adc r31, r25
	ldi r17, 4
	ldi r18, 1
plot_byte:
	lpm
	st X+, r0              ; copy palette entry as 0x00RRGGBB, little-endian
	add r30, r18
	adc r31, r25
	dec r17
	brne plot_byte
	ldi r16, 20
	add r2, r16
	adc r3, r25
	ldi r16, 128
	cp r2, r16
	cpc r3, r25
	breq next_row
	rjmp column
next_row:
	ldi r16, 20
	add r4, r16
	adc r5, r25
	ldi r16, 64
	ldi r17, 1              ; final ci = +320
	cp r4, r16
	cpc r5, r17
	breq done
	rjmp row
done:
	break

; r17:r16 * r19:r18 -> r17:r16, signed 8.8, truncating toward zero.
; Work registers: r0/r1, r20/r21, r31. All fractal state stays intact.
multiply:
	mov r31, r17
	eor r31, r19            ; sign of the product
	sbrs r17, 7
	rjmp a_positive
	com r16
	com r17
	subi r16, 255
	sbci r17, 255
a_positive:
	sbrs r19, 7
	rjmp b_positive
	com r18
	com r19
	subi r18, 255
	sbci r19, 255
b_positive:
	mul r16, r18
	mov r20, r1             ; discard the lowest product byte
	clr r21
	mul r17, r18
	add r20, r0
	adc r21, r1
	mul r16, r19
	add r20, r0
	adc r21, r1
	mul r17, r19
	add r21, r0
	mov r16, r20
	mov r17, r21
	sbrs r31, 7
	ret
	com r16
	com r17
	subi r16, 255
	sbci r17, 255
	ret

palette:
	.byte 0x30, 0x00, 0x00, 0x00
	.byte 0x4a, 0x10, 0x00, 0x00
	.byte 0x66, 0x1f, 0x00, 0x00
	.byte 0x80, 0x30, 0x00, 0x00
	.byte 0xa0, 0x44, 0x00, 0x00
	.byte 0xbd, 0x59, 0x00, 0x00
	.byte 0xd4, 0x72, 0x1a, 0x00
	.byte 0xe0, 0x8c, 0x3d, 0x00
	.byte 0xea, 0xa6, 0x62, 0x00
	.byte 0xf2, 0xbf, 0x86, 0x00
	.byte 0xf7, 0xd5, 0xa8, 0x00
	.byte 0xfb, 0xe6, 0xc6, 0x00
	.byte 0xfd, 0xf1, 0xde, 0x00
	.byte 0xfe, 0xf8, 0xef, 0x00
	.byte 0xff, 0xfc, 0xf8, 0x00
	.byte 0xff, 0xff, 0xff, 0x00
	.byte 0x00, 0x00, 0x00, 0x00
