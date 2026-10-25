; Bitwise Operations
; AND, OR and XOR on 12 and 10.

; Monitor ABI: LCALL 0xff00 with A = 0 exit, 1 print signed R6:R7, 2 character R7, 3 read signed R6:R7.
.text
	mov r6, #0
	mov a, #12
	anl a, #10
	mov r7, a
	mov a, #1
	lcall 0xff00

	mov r7, #10
	mov a, #2
	lcall 0xff00

	mov a, #12
	orl a, #10
	mov r7, a
	mov a, #1
	lcall 0xff00

	mov r7, #10
	mov a, #2
	lcall 0xff00

	mov a, #12
	xrl a, #10
	mov r7, a
	mov a, #1
	lcall 0xff00

	mov a, #0
	lcall 0xff00
