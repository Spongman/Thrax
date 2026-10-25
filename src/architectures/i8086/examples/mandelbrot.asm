; Mandelbrot Set
; CPU: Intel 8086, 8088, 80186, 80188
; FPU: none; signed 8.8 fixed point
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

.text
	mov di, 0x8000
	mov word [cy], -320
	mov word [row], 0
row_loop:
	mov word [cx_value], -512
	mov word [column], 0
pixel:
	mov word [x], 0
	mov word [y], 0
	mov word [iteration], 0
iterate:
	mov ax, [x]
	imul ax
	mov bp, 256
	idiv bp
	mov [xx], ax
	mov ax, [y]
	imul ax
	idiv bp
	mov [yy], ax
	add ax, [xx]
	cmp ax, 1024
	jge escaped
	mov ax, [x]
	imul word [y]
	mov bp, 256
	idiv bp
	shl ax, 1
	add ax, [cy]
	mov [y], ax
	mov ax, [xx]
	sub ax, [yy]
	add ax, [cx_value]
	mov [x], ax
	inc word [iteration]
	cmp word [iteration], 16
	jl iterate
escaped:
	mov si, [iteration]
	shl si, 1
	shl si, 1
	mov ax, [si + palette]
	mov [di], ax
	mov ax, [si + palette + 2]
	mov [di + 2], ax
	add di, 4
	add word [cx_value], 20
	inc word [column]
	cmp word [column], 32
	jge row_done
	jmp pixel
row_done:
	add word [cy], 20
	inc word [row]
	cmp word [row], 32
	jge done
	jmp row_loop
done:
	hlt

.org 0x9200
x: .word 0
y: .word 0
xx: .word 0
yy: .word 0
cx_value: .word 0
cy: .word 0
iteration: .word 0
row: .word 0
column: .word 0
palette:
.long 0x000030, 0x00104a, 0x001f66, 0x003080
.long 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
.long 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
.long 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff, 0
