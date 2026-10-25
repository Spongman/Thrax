; Interactive Input
; Read a signed integer and echo it.

.text
	mov ax, 4
	int 0x80
	mov bx, ax
	mov ax, 1
	int 0x80
	mov bx, 10
	mov ax, 2
	int 0x80
	hlt
