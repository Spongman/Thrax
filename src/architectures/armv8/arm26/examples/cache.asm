@ ARM3 Cache Controls
@ Read the CPU ID, enable the unified cache, multiply and flush through CP15.

	.org 0
	b start
	.org 0x8000
start:
	mrc p15, 0, r4, c0, c0, 0
	mov r0, #1
	mcr p15, 0, r0, c3, c0, 0
	mcr p15, 0, r0, c4, c0, 0
	mov r0, #0
	mcr p15, 0, r0, c5, c0, 0
	mov r0, #3
	mcr p15, 0, r0, c2, c0, 0
	mov r1, #5
	mov r2, #1
	mul r3, r1, r2
	mcr p15, 0, r0, c1, c0, 0
	mov r0, r3
	add r0, r0, #48
	swi OS_WriteC
	swi OS_Exit
