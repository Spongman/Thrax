; Factorial
; Compute 5! with the native MUL AB instruction.

; Monitor ABI: LCALL 0xff00 with A = 0 exit, 1 print signed R6:R7, 2 character R7, 3 read signed R6:R7.
.text
	mov r0, #5
	mov a, #1
loop:
	mov b, r0
	mul ab
	djnz r0, loop
	mov r6, #0
	mov r7, a
	mov a, #1
	lcall 0xff00

	mov a, #0
	lcall 0xff00
