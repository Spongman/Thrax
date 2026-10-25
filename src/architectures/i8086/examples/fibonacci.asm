; Fibonacci
; Compute F(10); prints 55.

.text
	mov bx, 0
	mov dx, 1
	mov cx, 10
again:
	mov ax, bx
	add ax, dx
	mov bx, dx
	mov dx, ax
	loop again
	mov ax, 1
	int 0x80
	mov bx, 10
	mov ax, 2
	int 0x80
	hlt
