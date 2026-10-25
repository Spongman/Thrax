; Trigonometry
; Reduce 100 radians by 2*pi with the 80187's IEEE FPREM1, then take FSINCOS;
; prints round(10000 * sin 100) and round(10000 * cos 100): -5064 8623.

	fninit
	fldpi
	fadd st(0), st(0)	; 2*pi
	fild word [angle]	; ST(0) = 100, ST(1) = 2*pi
	fprem1			; 100 - 16*2*pi = -0.531; FPREM would leave 5.752
	fsincos			; ST(0) = cosine, ST(1) = sine
	fimul word [scale]
	fistp word [cosine]
	fimul word [scale]
	fistp word [sine]
	fstp st(0)		; drop 2*pi
	mov bx, [sine]
	mov ax, 1
	int 0x80
	mov bx, 32
	mov ax, 2
	int 0x80
	mov bx, [cosine]
	mov ax, 1
	int 0x80
	hlt

.data
angle: .word 100
scale: .word 10000
sine: .word 0
cosine: .word 0
