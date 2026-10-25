; Hello, THRAX!
; Read a zero-terminated string from code space with MOVC.

; Monitor ABI: LCALL 0xff00 with A = 0 exit, 1 print signed R6:R7, 2 character R7, 3 read signed R6:R7.
.text
	mov dptr, #message
loop:
	clr a
	movc a, @a+dptr
	jz done
	mov r7, a
	mov a, #2
	lcall 0xff00
	inc dptr
	sjmp loop
done:
	mov a, #0
	lcall 0xff00

message: .asciz "Hello, THRAX!\n"
	mov a, #0
	lcall 0xff00
