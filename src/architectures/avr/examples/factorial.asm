; Factorial
; Compute 5! using MUL; the result 120 remains in r16

	ldi r16, 1
	ldi r17, 5
multiply:
	mul r16, r17
	mov r16, r0
	dec r17
	brne multiply
	break
