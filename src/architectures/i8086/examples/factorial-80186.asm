; Factorial
; Compute 5! with native 80186/80188 immediate IMUL; prints 120.

	mov ax, 1
	imul ax, ax, 2
	imul ax, ax, 3
	imul ax, ax, 4
	imul ax, ax, 5
	mov bx, ax
	mov ax, 1
	int 0x80
	mov bx, 10
	mov ax, 2
	int 0x80
	hlt
