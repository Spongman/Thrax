; Floating-point Arithmetic
; Compute sqrt(81) * 5 = 45 with the Intel 8087; prints 45.

	fninit
	fild word [input]
	fsqrt
	fimul word [factor]
	fistp word [answer]
	mov bx, [answer]
	mov ax, 1
	int 0x80
	hlt

.data
input: .word 81
factor: .word 5
answer: .word 0
