; Factorial
; Compute 5!; prints 120.

.text
	mov ax, 1
	mov cx, 5
again:
	mul cx
	loop again
	mov bx, ax
	mov ax, 1
	int 0x80
	mov bx, 10
	mov ax, 2
	int 0x80
	hlt
