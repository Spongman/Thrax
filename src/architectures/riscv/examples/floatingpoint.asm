# Floating-point Arithmetic
# Single-precision F arithmetic: a fused hypotenuse, rounding modes,
# exception flags and fclass. Prints 5, 314, 2, 3, 8 and 128.

.text
_start:
	la t0, values
	flw fa0, 0(t0)		# 3.0
	flw fa1, 4(t0)		# 4.0
	fmul.s fa2, fa0, fa0
	fmadd.s fa2, fa1, fa1, fa2	# 4 * 4 + 9 in one rounding
	fsqrt.s fa3, fa2
	fcvt.w.s a0, fa3
	call print_line		# 5

	flw fa4, 8(t0)		# pi
	flw fa5, 12(t0)		# radius 10
	fmul.s fa6, fa5, fa5
	fmul.s fa6, fa6, fa4
	fcvt.w.s a0, fa6, rtz	# truncate 314.159...
	call print_line		# 314

	flw fa7, 16(t0)		# 2.5
	fcvt.w.s a0, fa7	# dynamic mode: frm is rne, ties to even
	call print_line		# 2
	fcvt.w.s a0, fa7, rmm	# ties away from zero
	call print_line		# 3

	fsflags zero		# clear the accrued flags
	fmv.w.x ft0, zero
	fdiv.s ft1, fa0, ft0	# 3 / 0 is +infinity
	frflags a0
	call print_line		# 8: divide by zero (DZ)
	fclass.s a0, ft1
	call print_line		# 128: positive infinity
	ebreak

print_line:
	li a7, 1
	ecall
	li a0, '\n'
	li a7, 11
	ecall
	ret

.data
values:
	.float 3.0, 4.0, 3.14159265, 10.0, 2.5
