# Compressed Instructions
# Mix 16-bit and 32-bit instructions and print 42.

.text
_start:
	c.addi16sp sp, -16
	c.li a0, 21
	c.swsp a0, 0(sp)
	c.jal twice
	c.addi16sp sp, 16
	li a7, 1
	ecall
	c.ebreak

twice:
	c.lwsp a0, 0(sp)
	c.slli a0, 1
	c.jr ra
