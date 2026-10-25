; Mandelbrot Set
; CPU: Intel 8086, 8088, 80186, 80188
; FPU: Intel 8087 or 80187; single precision (precision control 24)
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

; Precision control 24 rounds every add and multiply as binary32 does, so the
; picture matches the MIPS single-precision one pixel for pixel.

.text
	fninit
	fldcw [control]
	mov di, 0x8000
	mov word [row], 0
row_loop:
	fild word [row]			; cy = yMin + row * step
	fmul dword [step]
	fadd dword [y_min]
	fstp dword [cy]
	mov word [column], 0
pixel:
	fild word [column]		; cx = xMin + column * step
	fmul dword [step]
	fadd dword [x_min]
	fstp dword [cx_value]
	fldz				; zy
	fldz				; zx; the stack holds zx, zy
	mov word [iteration], 0
iterate:
	fld st(0)
	fmul st(0), st(0)		; zx^2
	fld st(2)
	fmul st(0), st(0)		; zy^2
	fld st(0)
	fadd st(0), st(2)		; |z|^2, zy^2, zx^2, zx, zy
	fcomp dword [escape]
	fnstsw [status]
	test word [status], 0x4500	; C3, C2 and C0 all clear: 4 < |z|^2
	jz escaped
	fsubp st(1), st(0)		; zx^2 - zy^2
	fadd dword [cx_value]		; new zx
	fxch st(1)
	fmulp st(2), st(0)		; new zx, zx * zy
	fxch st(1)
	fadd st(0), st(0)
	fadd dword [cy]			; new zy = 2 * zx * zy + cy
	fxch st(1)
	inc word [iteration]
	cmp word [iteration], 16
	jl iterate
	jmp colour
escaped:
	fstp st(0)
	fstp st(0)
colour:
	fstp st(0)
	fstp st(0)
	mov si, [iteration]
	shl si, 1
	shl si, 1
	mov ax, [si + palette]
	mov [di], ax
	mov ax, [si + palette + 2]
	mov [di + 2], ax
	add di, 4
	inc word [column]
	cmp word [column], 32
	jge row_done
	jmp pixel
row_done:
	inc word [row]
	cmp word [row], 32
	jge done
	jmp row_loop
done:
	hlt

.org 0x9200
control: .word 0x007f		; PC 24 bits, round to nearest, exceptions masked
status: .word 0
row: .word 0
column: .word 0
iteration: .word 0
cx_value: .long 0
cy: .long 0
step: .long 0x3da00000		; 2.5 / 32
x_min: .long 0xc0000000		; -2.0
y_min: .long 0xbfa00000		; -1.25
escape: .long 0x40800000	; 4.0
palette:
.long 0x000030, 0x00104a, 0x001f66, 0x003080
.long 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
.long 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
.long 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff, 0
