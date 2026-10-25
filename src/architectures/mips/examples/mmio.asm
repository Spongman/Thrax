# Keyboard and Display
# Echo each character queued in the Keyboard and Display tool, until a period.

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
