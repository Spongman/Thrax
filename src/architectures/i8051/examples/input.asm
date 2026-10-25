; Interactive Input
; Read and echo a signed 16-bit integer.

; Monitor ABI: LCALL 0xff00 with A = 0 exit, 1 print signed R6:R7, 2 character R7, 3 read signed R6:R7.
.text
	mov a, #3
	lcall 0xff00
	mov a, #1
	lcall 0xff00

	mov a, #0
	lcall 0xff00
