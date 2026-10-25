# Memory and Rewind
# Store a byte, load it back signed and print -128.

.text
_start:
	la t0, value
	li t1, -128
	sb t1, 0(t0)
	lb a0, 0(t0)
	li a7, 1
	ecall
	ebreak

.data
value: .word 0
