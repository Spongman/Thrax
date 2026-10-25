; Loop Counter
; Print 1 through 5.

.text
	mov bx, 1
	mov cx, 5
again:
	mov ax, 1
	int 0x80
	push bx
	mov bx, 10
	mov ax, 2
	int 0x80
	pop bx
	inc bx
	loop again
	hlt
