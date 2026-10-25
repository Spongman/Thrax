# Floating-point Arithmetic
# Single-precision F and double-precision D arithmetic: a fused hypotenuse,
# rounding modes, exception flags, fclass, and one third at both precisions.
# Prints 5, 314, 2, 3, 8, 128, 333333333, 333333343 and 0.

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

	# One third, scaled by 10^9, in double and then in single precision.
	li t1, 1
	fcvt.d.w fs0, t1
	li t1, 3
	fcvt.d.w fs1, t1
	fdiv.d fs2, fs0, fs1	# 1/3 to 53 bits
	fld fs3, 24(t0)		# 1e9
	fmul.d fs4, fs2, fs3
	fcvt.w.d a0, fs4, rtz
	call print_line		# 333333333

	fcvt.s.d ft2, fs2	# 1/3 to 24 bits
	fcvt.d.s ft3, ft2
	fmul.d ft4, ft3, fs3
	fcvt.w.d a0, ft4, rtz
	call print_line		# 333333343

	feq.d a0, ft3, fs2	# the two thirds differ
	call print_line		# 0
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
	.align 3
	.double 1e9
