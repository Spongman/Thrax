# Coprocessors
# Coprocessor 1 arithmetic, comparison and conversion, plus a coprocessor 0 register read.

.data
sideA:		.float 3.0
sideB:		.float 4.0
hypotenuse:	.asciiz "hypotenuse = "
area:		.asciiz "area = "
status:		.asciiz "cp0 status = "
smallerText:	.asciiz "a < b\n"
largerText:	.asciiz "a >= b\n"
newline:	.asciiz "\n"

.text
main:
	l.s $f0, sideA
	l.s $f2, sideB

	# sqrt(a * a + b * b), printed with syscall 2
	mul.s $f4, $f0, $f0
	mul.s $f6, $f2, $f2
	add.s $f8, $f4, $f6
	sqrt.s $f12, $f8

	la $a0, hypotenuse
	li $v0, 4
	syscall
	li $v0, 2
	syscall
	la $a0, newline
	li $v0, 4
	syscall

	# a * b / 2, rounded into an integer register with cvt.w.s
	mul.s $f10, $f0, $f2
	li.s $f14, 2.0
	div.s $f10, $f10, $f14
	cvt.w.s $f10, $f10

	la $a0, area
	li $v0, 4
	syscall
	mfc1 $a0, $f10
	li $v0, 1
	syscall
	la $a0, newline
	li $v0, 4
	syscall

	# c.lt.s sets condition flag 0, which bc1t branches on
	c.lt.s $f0, $f2
	bc1t smaller
	la $a0, largerText
	j report
smaller:
	la $a0, smallerText
report:
	li $v0, 4
	syscall

	# Coprocessor 0 holds the status, cause, epc, and vaddr registers
	la $a0, status
	li $v0, 4
	syscall
	mfc0 $a0, $12
	li $v0, 34
	syscall
	la $a0, newline
	li $v0, 4
	syscall

	li $v0, 10
	syscall
