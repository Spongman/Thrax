; Sum of Numbers
; Add 3 and 5; prints 8.

.text
	mov bx, 3
	add bx, 5
	mov ax, 1
	int 0x80
	mov bx, 10
	mov ax, 2
	int 0x80
	hlt
