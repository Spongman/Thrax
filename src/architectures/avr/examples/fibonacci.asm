; Fibonacci
; Compute the 10th Fibonacci number; the result 55 remains in r16

	clr r16
	ldi r17, 1
	ldi r18, 10
loop:
	mov r19, r16
	add r19, r17
	mov r16, r17
	mov r17, r19
	dec r18
	brne loop
	break
