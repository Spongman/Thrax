; Mandelbrot Set
; CPU: Texas Instruments TMS9900
; FPU: none; signed 8.8 fixed point
; 32 x 32 pixels, 16 iterations, x in [-2.0, 0.5), y in [-1.25, 1.25)

.equ MAXITER, 16

.text
_start:
	LI R8, pixels
	LI R5, -320
	CLR R6
row:
	LI R4, -512
	CLR R7
column:
	CLR R1
	CLR R2
	CLR R9
iterate:
	MOV R1, R0
	MOV R1, R3
	BL @multiply
	MOV R0, R12
	MOV R2, R0
	MOV R2, R3
	BL @multiply
	MOV R0, R13
	MOV R12, R0
	A R13, R0
	CI R0, 1024
	JHE escaped
	MOV R1, R0
	MOV R2, R3
	BL @multiply
	SLA R0, 1
	A R5, R0
	MOV R0, R2
	MOV R12, R1
	S R13, R1
	A R4, R1
	INC R9
	CI R9, MAXITER
	JLT iterate
escaped:
	SLA R9, 2
	MOVB @palette + 3(R9), *R8+
	MOVB @palette + 2(R9), *R8+
	MOVB @palette + 1(R9), *R8+
	MOVB @palette(R9), *R8+
	AI R4, 20
	INC R7
	CI R7, 32
	JLT column
	AI R5, 20
	INC R6
	CI R6, 32
	JLT row
	LI R0, 10
	XOP R1, 15

multiply:
	CLR R10
	CI R0, 0
	JGT firstPositive
	JEQ firstPositive
	NEG R0
	INC R10
firstPositive:
	CI R3, 0
	JGT secondPositive
	JEQ secondPositive
	NEG R3
	INC R10
secondPositive:
	MOV R0, R14
	MPY R3, R14
	DIV @scale, R14
	MOV R14, R0
	ANDI R10, 1
	JEQ productPositive
	NEG R0
productPositive:
	RT

.data
pixels: .space 4096
palette:
.long 0x000030, 0x00104a, 0x001f66, 0x003080
.long 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
.long 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
.long 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
.long 0x000000
scale: .word 256
