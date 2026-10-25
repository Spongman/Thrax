; Bitwise Operations
; AND, OR and XOR of 12 and 10 produce 8, 14 and 6.

.text
	mov bx, 12
	and bx, 10
	mov ax, 1
	int 0x80
	mov bx, 10
	mov ax, 2
	int 0x80
	mov bx, 12
	or bx, 10
	mov ax, 1
	int 0x80
	mov bx, 10
	mov ax, 2
	int 0x80
	mov bx, 12
	xor bx, 10
	mov ax, 1
	int 0x80
	mov bx, 10
	mov ax, 2
	int 0x80
	hlt
