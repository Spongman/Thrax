; Fibonacci
; Calculate the tenth Fibonacci number.

; Monitor ABI: LCALL 0xff00 with A = 0 exit, 1 print signed R6:R7, 2 character R7, 3 read signed R6:R7.
.text
	mov r2, #0
	mov r3, #1
	mov r4, #10
loop:
	mov a, r2
	add a, r3
	mov r2, 3
	mov r3, a
	djnz r4, loop
	mov r6, #0
	mov r7, 2
	mov a, #1
	lcall 0xff00

	mov a, #0
	lcall 0xff00
