; Ackermann
; Compute A(3, 3) = 61 recursively, using A(1,n)=n+2 to keep the native 128-byte stack in range.

; Monitor ABI: LCALL 0xff00 with A = 0 exit, 1 print signed R6:R7, 2 character R7, 3 read signed R6:R7.
.text
	mov r6, #3
	mov r7, #3
	lcall ackermann
	mov r6, #0
	mov a, #1
	lcall 0xff00

	mov a, #0
	lcall 0xff00

ackermann:
	mov a, r6
	jnz ack_nonzero
	inc r7
	ret
ack_nonzero:
	cjne a, #1, ack_general
	inc r7
	inc r7
	ret
ack_general:
	mov a, r7
	jnz ack_recursive
	dec r6
	mov r7, #1
	lcall ackermann
	ret
ack_recursive:
	push 6
	dec r7
	lcall ackermann
	pop 6
	dec r6
	lcall ackermann
	ret
	mov a, #0
	lcall 0xff00
