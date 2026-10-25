; Ackermann
; Recursive A(3, 3); prints 61.

.text
	mov ax, 3
	mov bx, 3
	call ackermann
	mov bx, ax
	mov ax, 1
	int 0x80
	mov bx, 10
	mov ax, 2
	int 0x80
	hlt

ackermann:
	cmp ax, 0
	jne nonzero
	mov ax, bx
	inc ax
	ret
nonzero:
	cmp bx, 0
	jne recurse
	dec ax
	mov bx, 1
	call ackermann
	ret
recurse:
	push ax
	dec bx
	call ackermann
	mov bx, ax
	pop ax
	dec ax
	call ackermann
	ret
