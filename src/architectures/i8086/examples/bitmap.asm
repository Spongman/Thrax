; Bitmap Display
; Draw a 32 by 32 RGB gradient.

.text
	mov di, 0x8000
	mov bp, 0
row:
	mov si, 0
column:
	mov ax, si
	shl ax, 1
	shl ax, 1
	shl ax, 1
	mov [di], ax
	mov ax, bp
	shl ax, 1
	shl ax, 1
	shl ax, 1
	mov [di + 2], ax
	add di, 4
	inc si
	cmp si, 32
	jb column
	inc bp
	cmp bp, 32
	jb row
	hlt
