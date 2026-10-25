; Loop Counter
; Print the integers 1 through 5.

; Monitor ABI: LCALL 0xff00 with A = 0 exit, 1 print signed R6:R7, 2 character R7, 3 read signed R6:R7.
.text
	mov r0, #1
	mov r6, #0
loop:
	mov r7, 0
	mov a, #1
	lcall 0xff00

	mov r7, #10
	mov a, #2
	lcall 0xff00

	inc r0
	cjne r0, #6, loop
	mov a, #0
	lcall 0xff00
