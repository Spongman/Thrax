; Bitmap Display
; Draw a 32 by 32 RGB gradient through native MOVX writes to XDATA.

; Monitor ABI: LCALL 0xff00 with A = 0 exit, 1 print signed R6:R7, 2 character R7, 3 read signed R6:R7.
.text
	mov dptr, #0
	mov r0, #0
row_loop:
	mov r1, #0
column_loop:
	mov a, r1
	movx @dptr, a
	inc dptr
	clr a
	movx @dptr, a
	inc dptr
	mov a, r0
	movx @dptr, a
	inc dptr
	clr a
	movx @dptr, a
	inc dptr
	mov a, r1
	add a, #8
	mov r1, a
	jnz column_loop
	mov a, r0
	add a, #8
	mov r0, a
	jnz row_loop
	mov a, #0
	lcall 0xff00
