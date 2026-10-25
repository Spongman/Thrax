; Ackermann
; Nested recursive calls compute A(3, 3) = 61 in r16 and SRAM at debugger 0x10100

; m in r20, n in r21, result in r16. RCALL/RET use the SRAM stack.

	ldi r20, 3
	ldi r21, 3
	rcall ackermann
	sts 0x100, r16
	break
ackermann:
	tst r20
	breq base
	tst r21
	breq zero
	push r20
	dec r21
	rcall ackermann
	pop r20
	mov r21, r16
	dec r20
	rjmp ackermann
zero:
	dec r20
	ldi r21, 1
	rjmp ackermann
base:
	mov r16, r21
	inc r16
	ret
