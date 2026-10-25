# Floating-point Arithmetic
# Compute sqrt(3*3 + 4*4) * 9 = 45 with the integrated FPU, then show that
# 1/3 rounded to single differs from 1/3 in double; prints 45 1.

.text
_start:
	lis r9, 1
	ori r9, r9, values & 65535
	lfd f1, 0(r9)		# 3.0
	lfd f2, 8(r9)		# 4.0
	lfd f3, 16(r9)		# 9.0
	fmul f4, f1, f1		# 3 * 3
	fmadd f4, f2, f2, f4	# 4 * 4 + 9 = 25, fused with one rounding
	fsqrt f5, f4		# 5
	fmul f6, f5, f3		# 45
	fctiwz f7, f6		# signed word in the low half of f7
	addi r10, r9, result - values
	stfiwx f7, 0, r10	# hand the word to the integer unit
	lwz r3, 0(r10)
	li r0, 1
	sc
	li r3, 32
	li r0, 11
	sc
	lfd f8, 24(r9)		# 1.0
	fdiv f9, f8, f1		# 1/3 rounded to double
	fdivs f10, f8, f1	# 1/3 rounded to single
	fcmpu cr0, f9, f10
	li r3, 0
	beq same
	li r3, 1
same:
	li r0, 1
	sc
	li r0, 10
	sc

.data
values:
	.long 0x40080000, 0	# 3.0
	.long 0x40100000, 0	# 4.0
	.long 0x40220000, 0	# 9.0
	.long 0x3ff00000, 0	# 1.0
result:	.long 0
