; Bitmap Display
; Draw a 32 by 32 RGB gradient.

.text
_start:
	mov32 #pixels, r8
	mov #0, r12
row:
	mov #0, r13
pixel:
	mov r12, r1
	shll16 r1
	shll2 r1
	shll r1
	mov r13, r0
	shll2 r0
	shll r0
	or r1, r0
	mov.b r0, @r8
	shlr8 r0
	mov.b r0, @(1, r8)
	shlr8 r0
	mov.b r0, @(2, r8)
	mov #0, r0
	mov.b r0, @(3, r8)
	add #4, r8
	add #1, r13
	mov #32, r0
	cmp/ge r0, r13
	bf pixel
	add #1, r12
	cmp/ge r0, r12
	bf row
	mov #10, r0
	trapa #0x10

.data
pixels: .space 4096
