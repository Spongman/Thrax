# Macros
# Define once, use many times: macros expand in place, so a use costs no call and return.

.eqv PRINT_STRING	4
.eqv PRINT_INT		1
.eqv EXIT		10

.macro print_string (%text)
	la $a0, %text
	li $v0, PRINT_STRING
	syscall
.end_macro

# Labels inside a body are renamed per expansion, so "again" can be reused.
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
newline:	.asciiz "
"

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
