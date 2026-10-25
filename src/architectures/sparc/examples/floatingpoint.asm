! Floating-point Arithmetic
! Double and single precision FPops, truncating conversion and an
! FCMPd/FBfcc decision. SPARC has no integer/FP register move, so
! integers pass through memory with ST and LD.

.text
_start:
	set scratch, %l0

	! sqrt(81) * 5 in double precision; pairs hold the high word in the even register.
	mov 81, %l1
	st %l1, [%l0]
	ld [%l0], %f0
	fitod %f0, %f2		! %f2:%f3 = 81.0
	fsqrtd %f2, %f2		! 9.0
	mov 5, %l1
	st %l1, [%l0]
	ld [%l0], %f4
	fitod %f4, %f4		! 5.0
	fmuld %f2, %f4, %f2	! 45.0
	fdtoi %f2, %f6
	set first, %o0
	call print
	st %f6, [%l0]		! delay slot: hand the integer to print

	! 1000 * 22 / 7 in single precision; FsTOi truncates 3142.857
	mov 22, %l1
	st %l1, [%l0]
	ld [%l0], %f8
	fitos %f8, %f8
	mov 7, %l1
	st %l1, [%l0]
	ld [%l0], %f9
	fitos %f9, %f9
	fdivs %f8, %f9, %f8
	mov 1000, %l1
	st %l1, [%l0]
	ld [%l0], %f9
	fitos %f9, %f9
	fmuls %f8, %f9, %f8
	fstoi %f8, %f8
	set second, %o0
	call print
	st %f8, [%l0]

	! 1/10 + 2/10 against 3/10 in double precision
	mov 10, %l1
	st %l1, [%l0]
	ld [%l0], %f10
	fitod %f10, %f10	! 10.0
	mov 1, %l1
	st %l1, [%l0]
	ld [%l0], %f12
	fitod %f12, %f12
	fdivd %f12, %f10, %f12	! 0.1
	mov 2, %l1
	st %l1, [%l0]
	ld [%l0], %f14
	fitod %f14, %f14
	fdivd %f14, %f10, %f14	! 0.2
	faddd %f12, %f14, %f12	! 0.30000000000000004
	mov 3, %l1
	st %l1, [%l0]
	ld [%l0], %f14
	fitod %f14, %f14
	fdivd %f14, %f10, %f14	! 0.3
	fcmpd %f12, %f14
	set greater, %o0	! V8: something must separate FCMP and FBfcc
	fbg report
	nop
	set notGreater, %o0
report:
	mov 4, %g1
	ta 0x10
	mov 10, %g1
	ta 0x10

! Print the string at %o0, the integer at [%l0], then a newline.
print:
	mov 4, %g1
	ta 0x10
	ld [%l0], %o0
	mov 1, %g1
	ta 0x10
	mov 10, %o0
	mov 11, %g1
	ta 0x10
	retl
	nop

.data
scratch: .word 0
first: .asciz "sqrt(81) * 5 = "
second: .asciz "1000 * 22 / 7 = "
greater: .asciz "0.1 + 0.2 > 0.3\n"
notGreater: .asciz "0.1 + 0.2 <= 0.3\n"
