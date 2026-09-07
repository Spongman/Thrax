import { BitmapIcon, BitwiseIcon, CoprocessorIcon, FactorialIcon, FibonacciIcon, HelloIcon, InputIcon, KeyboardIcon, LoopIcon, MacrosIcon, MandelbrotIcon, RecursionIcon, SumIcon } from './components/icons'

/**
 * Example MIPS Programs
 */

export const EXAMPLES = {
	input: {
		icon: InputIcon,
		name: 'Interactive Input',
		description: 'Read and echo a string using syscall 8',
		code: `# Read a line into a data buffer, then print it

.data
buffer: .space 64

.text
main:
	la $a0, buffer
	li $a1, 64
	li $v0, 8
	syscall

	la $a0, buffer
	li $v0, 4
	syscall

	li $v0, 10
	syscall
`,
	},

	hello: {
		icon: HelloIcon,
		name: 'Hello, THRAX!',
		description: 'Print a string stored in the data segment',
		code: `# Data directives and print-string syscall

.data
message: .asciiz "Hello, THRAX!\\n"

.text
main:
	la $a0, message
	li $v0, 4
	syscall

	li $v0, 10
	syscall
`,
	},

	sum: {
		icon: SumIcon,
		name: 'Sum of Numbers',
		description: 'Add 5 + 3 and print the result',
		code: `# Simple addition example
# Compute 5 + 3 = 8

.text

main:
	# Load values
	addi $t0, $zero, 5      # $t0 = 5
	addi $t1, $zero, 3      # $t1 = 3
	
	# Add them
	add $t2, $t0, $t1       # $t2 = $t0 + $t1 = 8
	
	# Print result
	move $a0, $t2           # $a0 = $t2 (argument for syscall)
	addi $v0, $zero, 1      # $v0 = 1 (print integer syscall)
	syscall
	
	# Print newline
	addi $a0, $zero, 10     # ASCII code for newline
	addi $v0, $zero, 11     # $v0 = 11 (print character syscall)
	syscall
	
	# Exit
	addi $v0, $zero, 10     # $v0 = 10 (exit syscall)
	syscall
`,
	},

	factorial: {
		icon: FactorialIcon,
		name: 'Factorial',
		description: 'Compute 5! (5 factorial) = 120',
		code: `# Factorial example
# Compute 5! = 5 * 4 * 3 * 2 * 1 = 120

.text

main:
	addi $t0, $zero, 5      # n = 5
	addi $t1, $zero, 1      # result = 1
	
loop:
	beq $t0, $zero, done    # if n == 0, exit loop
	mul $t1, $t1, $t0       # result = result * n
	addi $t0, $t0, -1       # n--
	j loop
	
done:
	# Print result
	move $a0, $t1
	addi $v0, $zero, 1
	syscall
	
	# Exit
	addi $v0, $zero, 10
	syscall
`,
	},

	fibonacci: {
		icon: FibonacciIcon,
		name: 'Fibonacci',
		description: 'Compute the 10th Fibonacci number',
		code: `# Fibonacci sequence
# Compute fib(10)

.text

main:
	addi $t0, $zero, 0      # fib(0) = 0
	addi $t1, $zero, 1      # fib(1) = 1
	addi $t2, $zero, 10     # counter = 10
	addi $t3, $zero, 2      # i = 2
	
loop:
	bgt $t3, $t2, done      # if i > 10, exit
	add $t4, $t0, $t1       # temp = fib(n-2) + fib(n-1)
	move $t0, $t1           # fib(n-2) = fib(n-1)
	move $t1, $t4           # fib(n-1) = temp
	addi $t3, $t3, 1        # i++
	j loop
	
done:
	# Print result
	move $a0, $t1
	addi $v0, $zero, 1
	syscall
	
	# Exit
	addi $v0, $zero, 10
	syscall
`,
	},

	ackermann: {
		icon: RecursionIcon,
		name: 'Ackermann',
		description: 'Deep recursion: compute A(3, 3) = 61',
		code: `# Ackermann function
# A(m, n) = n + 1                    when m = 0
#         = A(m - 1, 1)              when n = 0
#         = A(m - 1, A(m, n - 1))    otherwise
#
# Each call saves its return address on the stack, so the call stack
# and the stack segment fill up as the recursion deepens.

.data
prompt:	.asciiz "A(3, 3) = "

.text

main:
	li $v0, 4               # print the label
	la $a0, prompt
	syscall

	li $a0, 3               # m = 3
	li $a1, 3               # n = 3
	jal ackermann

	move $a0, $v0           # print the result
	li $v0, 1
	syscall

	li $v0, 10              # exit
	syscall

# $a0 = m, $a1 = n, result in $v0
ackermann:
	addi $sp, $sp, -12      # frame: return address, m, n
	sw $ra, 0($sp)
	sw $a0, 4($sp)
	sw $a1, 8($sp)

	bne $a0, $zero, m_positive
	addi $v0, $a1, 1        # m = 0: A(0, n) = n + 1
	j ackermann_return

m_positive:
	bne $a1, $zero, both_positive
	addi $a0, $a0, -1       # n = 0: A(m, 0) = A(m - 1, 1)
	li $a1, 1
	jal ackermann
	j ackermann_return

both_positive:
	addi $a1, $a1, -1       # inner call: A(m, n - 1)
	jal ackermann

	lw $a0, 4($sp)          # outer call: A(m - 1, inner)
	addi $a0, $a0, -1
	move $a1, $v0
	jal ackermann

ackermann_return:
	lw $ra, 0($sp)
	addi $sp, $sp, 12
	jr $ra
`,
	},

	loop: {
		icon: LoopIcon,
		name: 'Loop Counter',
		description: 'Print numbers from 1 to 5',
		code: `# Loop counter example
# Print numbers 1 through 5

.text

main:
	addi $t0, $zero, 1      # counter = 1
	
loop:
	addi $t1, $zero, 6      # load 6 for comparison
	beq $t0, $t1, done      # if counter == 6, exit
	
	# Print counter
	move $a0, $t0
	addi $v0, $zero, 1
	syscall
	
	# Print space
	addi $a0, $zero, 32     # ASCII space
	addi $v0, $zero, 11
	syscall
	
	# Increment and loop
	addi $t0, $t0, 1
	j loop
	
done:
	# Print newline
	addi $a0, $zero, 10
	addi $v0, $zero, 11
	syscall
	
	# Exit
	addi $v0, $zero, 10
	syscall
`,
	},

	coprocessor: {
		icon: CoprocessorIcon,
		name: 'Coprocessors',
		description: 'Floating-point math on CP1 and a CP0 register read',
		code: `# Coprocessor 1 arithmetic, comparison, and conversion,
# plus a coprocessor 0 register read.

.data
sideA:		.float 3.0
sideB:		.float 4.0
hypotenuse:	.asciiz "hypotenuse = "
area:		.asciiz "area = "
status:		.asciiz "cp0 status = "
smallerText:	.asciiz "a < b\\n"
largerText:	.asciiz "a >= b\\n"
newline:	.asciiz "\\n"

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
`,
	},

	bitwise: {
		icon: BitwiseIcon,
		name: 'Bitwise Operations',
		description: 'Demonstrate AND, OR, XOR operations',
		code: `# Bitwise operations
# Test AND, OR, XOR with two values

.text

main:
	addi $t0, $zero, 12     # $t0 = 12 (binary: 1100)
	addi $t1, $zero, 10     # $t1 = 10 (binary: 1010)
	
	# AND operation
	and $t2, $t0, $t1       # $t2 = 12 & 10 = 8
	move $a0, $t2
	addi $v0, $zero, 1
	syscall
	
	addi $a0, $zero, 32
	addi $v0, $zero, 11
	syscall
	
	# OR operation
	or $t2, $t0, $t1        # $t2 = 12 | 10 = 14
	move $a0, $t2
	addi $v0, $zero, 1
	syscall
	
	addi $a0, $zero, 32
	addi $v0, $zero, 11
	syscall
	
	# XOR operation
	xor $t2, $t0, $t1       # $t2 = 12 ^ 10 = 6
	move $a0, $t2
	addi $v0, $zero, 1
	syscall
	
	# Exit
	addi $v0, $zero, 10
	syscall
`,
	},

	bitmap: {
		icon: BitmapIcon,
		name: 'Bitmap Display',
		description: 'Draw a colour gradient for the Bitmap Display tool',
		code: `# Fill a 32 x 32 grid of pixels for the Bitmap Display tool.
# Tool settings: base address 0x10010000, unit 8, width 256, height 256.
# Each word is one pixel, 0x00RRGGBB, in row-major order.

.data
display:	.space 4096		# 32 rows x 32 columns x 4 bytes

.text
main:
	la $t0, display
	li $t7, 32			# rows and columns
	li $t1, 0			# row

row:
	li $t2, 0			# column

column:
	sll $t3, $t1, 19		# row scaled into the red channel
	sll $t4, $t2, 3			# column scaled into the blue channel
	or $t5, $t3, $t4
	sw $t5, 0($t0)

	addi $t0, $t0, 4
	addi $t2, $t2, 1
	bne $t2, $t7, column

	addi $t1, $t1, 1
	bne $t1, $t7, row

	li $v0, 10
	syscall
`,
	},

	mmio: {
		icon: KeyboardIcon,
		name: 'Keyboard and Display',
		description: 'Echo queued keystrokes through the MMIO tool',
		code: `# Memory-mapped I/O, through the Keyboard and Display Simulator.
# Queue characters in the tool while the program runs; each one is
# echoed to the display. A period ends the program.

.eqv MMIO		0xffff0000
.eqv RECEIVER_CONTROL	0
.eqv RECEIVER_DATA	4
.eqv TRANSMITTER_DATA	12
.eqv PERIOD		46

.text
main:
	li $t0, MMIO
	li $t3, PERIOD

poll:
	lw $t1, RECEIVER_CONTROL($t0)	# bit 0 is set once a character is ready
	andi $t1, $t1, 1
	beq $t1, $zero, poll

	lw $t2, RECEIVER_DATA($t0)	# reading the data word consumes the character
	sw $t2, TRANSMITTER_DATA($t0)	# writing it prints to the display
	bne $t2, $t3, poll

	li $v0, 10
	syscall
`,
	},

	macros: {
		icon: MacrosIcon,
		name: 'Macros',
		description: 'Define once, use many times with .macro and .eqv',
		code: `# Macros are expanded by the assembler, so each call costs no
# call-and-return overhead. Labels inside a body are renamed per
# expansion, which is why "again" can be reused safely.

.eqv PRINT_STRING	4
.eqv PRINT_INT		1
.eqv EXIT		10

.macro print_string (%text)
	la $a0, %text
	li $v0, PRINT_STRING
	syscall
.end_macro

.macro count_to (%limit)
	li $t0, 0
again:
	addi $t0, $t0, 1
	move $a0, $t0
	li $v0, PRINT_INT
	syscall
	bne $t0, %limit, again
.end_macro

.macro done
	li $v0, EXIT
	syscall
.end_macro

.data
banner:		.asciiz "counting: "
newline:	.asciiz "\n"

.text
main:
	print_string (banner)

	li $t9, 5
	count_to ($t9)
	print_string (newline)

	li $t9, 3
	count_to ($t9)
	print_string (newline)

	done
`,
	},
	mandelbrot: {
		icon: MandelbrotIcon,
		name: 'Mandelbrot Set',
		description: 'Escape-time fractal on coprocessor 1, drawn to the Bitmap Display',
		code: `# Mandelbrot set, rendered with single-precision coprocessor 1 arithmetic.
#
# Open the Bitmap Display tool with base 0x10010000 and 256 x 256.  SIZE
# below is the grid in pixels, so set the unit to match: 8 for SIZE 32,
# 4 for SIZE 64.  Everything else scales off SIZE on its own.
#
# For each pixel, c = cx + i*cy and z starts at 0.  The loop iterates
# z = z^2 + c until |z|^2 leaves the escape radius of 4, and colours the
# pixel by how many iterations that took.  Points that never escape are
# inside the set and stay black.

.data
frame:		.space 16384		# room for 64 x 64 pixels, one word each

# Iteration count to colour: index 0 escapes at once, index MAXITER is interior.
palette:	.word 0x000030, 0x00104a, 0x001f66, 0x003080
		.word 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0
		.word 0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb
		.word 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff
		.word 0x000000

# The view is x in [-2.0, 0.5) and y in [-1.25, 1.25).  One cell is
# span / SIZE across, worked out at run time so SIZE stays the only knob;
# for any power-of-two SIZE that division is exact in binary.
xMin:		.float -2.0
yMin:		.float -1.25
span:		.float 2.5
escape:		.float 4.0
two:		.float 2.0

.eqv SIZE 32
.eqv MAXITER 16

.text
main:
	la $s2, frame			# cursor into the frame buffer
	li $s3, SIZE
	li $s4, MAXITER

	l.s $f16, span			# step = span / SIZE
	mtc1 $s3, $f2
	cvt.s.w $f2, $f2
	div.s $f16, $f16, $f2

	l.s $f18, escape
	l.s $f20, two
	l.s $f22, xMin
	l.s $f24, yMin

	li $s0, 0			# row
rowLoop:
	# cy = yMin + row * step
	mtc1 $s0, $f2
	cvt.s.w $f2, $f2
	mul.s $f2, $f2, $f16
	add.s $f2, $f2, $f24

	li $s1, 0			# column
columnLoop:
	# cx = xMin + column * step
	mtc1 $s1, $f0
	cvt.s.w $f0, $f0
	mul.s $f0, $f0, $f16
	add.s $f0, $f0, $f22

	mtc1 $zero, $f4			# zx = 0.0
	mtc1 $zero, $f6			# zy = 0.0
	li $t0, 0			# iteration

iterate:
	mul.s $f8, $f4, $f4		# zx^2
	mul.s $f10, $f6, $f6		# zy^2
	add.s $f12, $f8, $f10		# |z|^2

	# c.lt.s sets condition flag 0, so bc1t takes the branch once 4 < |z|^2
	c.lt.s $f18, $f12
	bc1t escaped

	mul.s $f14, $f4, $f6		# zy = 2*zx*zy + cy
	mul.s $f14, $f14, $f20
	add.s $f6, $f14, $f2

	sub.s $f4, $f8, $f10		# zx = zx^2 - zy^2 + cx
	add.s $f4, $f4, $f0

	addi $t0, $t0, 1
	bne $t0, $s4, iterate

escaped:
	# Colour the pixel by its iteration count and advance the cursor.
	sll $t1, $t0, 2
	la $t2, palette
	add $t2, $t2, $t1
	lw $t3, 0($t2)
	sw $t3, 0($s2)
	addi $s2, $s2, 4

	addi $s1, $s1, 1
	bne $s1, $s3, columnLoop

	addi $s0, $s0, 1
	bne $s0, $s3, rowLoop

	li $v0, 10
	syscall
`,
	},
}
