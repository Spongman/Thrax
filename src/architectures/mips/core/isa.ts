/**
 * The instruction signature table.
 *
 * Every basic record is one instruction form, 155 forms over 139 mnemonics,
 * keeping its 32-character bit pattern verbatim.  Mask and match are derived
 * from that pattern, and `findByBinary` resolves a word longest-mask-first.  A
 * mask/match table is what the selection actually needs: opcode 1 selects on
 * `rt`, COP1 selects on `rs` then `funct` then the `tf` bit, and `nop` and
 * `sll $zero,$zero,0` are the same word.
 *
 * The pseudo table is 388 forms over 83 mnemonics, plus three extras (`bal`,
 * `li.s`, `li.d`) this port adds, marked `thraxExtension`.
 *
 * What the table deliberately does not express, and stays in the assembler:
 *
 * - variadic arity: `jalr $t1` / `jalr $t1,$t2` and `break` / `break 100` are
 *   separate records, but choosing between them by operand count is the
 *   assembler's job (`assembler.ts:922`, `:800`).
 * - the `move`/`nop` pseudo-passthrough (`assembler.ts:791-800`).
 * - PC-relative branch offsets and the jump target's 4 high bits, which come
 *   from the address being encoded, not from the operand (`assembler.ts:984-987`).
 * - the CP0 register namespace: `cp0` names a register file this table does not
 *   enumerate (`assembler.ts:890`).
 * - `C.cond.fmt`'s condition code, which occupies the top 3 bits of the `fd`
 *   field rather than a field of its own (`assembler.ts:858-866`, `:881`).
 */

/** The four basic instruction formats. */
export type IsaFormat = 'R' | 'I' | 'I-branch' | 'J'

/**
 * One operand slot's kind.  The first twelve describe basic instructions; the
 * rest are the extended operand shapes only pseudo-instructions accept.
 */
export type IsaOperandKind =
	| 'gpr'
	| 'fpr'
	| 'fpr-even'
	| 'cp0'
	| 'imm16s'
	| 'imm16u'
	| 'imm5'
	| 'imm3'
	| 'imm20'
	| 'label'
	| 'mem'
	| 'target26'
	| 'imm32'
	| 'float'
	| 'base'
	| 'mem32'
	| 'label-mem'
	| 'label-offset'
	| 'label-offset-mem'

/**
 * Where one of the operand letters sits in the word.  `f` is the first
 * source operand, `s` the second, `t` the third; a `mem` operand spends two
 * letters, its offset and its base register.
 */
export interface IsaField {
	letter: 'f' | 's' | 't'
	/** Bit position of the field's low bit. */
	shift: number
	width: number
}

/** One basic instruction form: a machine word shape and the syntax that writes it. */
export interface BasicInstruction {
	/** Lower case. */
	mnemonic: string
	/** The operand pattern, one kind per comma-separated operand of `example`. */
	operands: readonly IsaOperandKind[]
	format: IsaFormat
	/** The bit pattern, spaces squeezed out: 32 characters of `01fst c`. */
	pattern: string
	/** 1 where `pattern` fixes a bit. */
	mask: number
	/** The fixed bits' values. */
	match: number
	/** Field placement, in `f`, `s`, `t` order. */
	fields: readonly IsaField[]
	/** The example line, the syntax this record accepts. */
	example: string
}

/** One pseudo-instruction form. */
export interface PseudoInstruction {
	mnemonic: string
	operands: readonly IsaOperandKind[]
	/** The example line. */
	example: string
	/** Set on the three forms this port adds. */
	thraxExtension?: true
}

/**
 * `[example, format, bit pattern]` for each of the 155 basic forms, in order.
 */
const BASIC_SOURCE: readonly (readonly [string, IsaFormat, string])[] = [
	['nop', 'R', '000000 00000 00000 00000 00000 000000'],
	['add $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 100000'],
	['sub $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 100010'],
	['addi $t1,$t2,-100', 'I', '001000 sssss fffff tttttttttttttttt'],
	['addu $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 100001'],
	['subu $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 100011'],
	['addiu $t1,$t2,-100', 'I', '001001 sssss fffff tttttttttttttttt'],
	['mult $t1,$t2', 'R', '000000 fffff sssss 00000 00000 011000'],
	['multu $t1,$t2', 'R', '000000 fffff sssss 00000 00000 011001'],
	['mul $t1,$t2,$t3', 'R', '011100 sssss ttttt fffff 00000 000010'],
	['madd $t1,$t2', 'R', '011100 fffff sssss 00000 00000 000000'],
	['maddu $t1,$t2', 'R', '011100 fffff sssss 00000 00000 000001'],
	['msub $t1,$t2', 'R', '011100 fffff sssss 00000 00000 000100'],
	['msubu $t1,$t2', 'R', '011100 fffff sssss 00000 00000 000101'],
	['div $t1,$t2', 'R', '000000 fffff sssss 00000 00000 011010'],
	['divu $t1,$t2', 'R', '000000 fffff sssss 00000 00000 011011'],
	['mfhi $t1', 'R', '000000 00000 00000 fffff 00000 010000'],
	['mflo $t1', 'R', '000000 00000 00000 fffff 00000 010010'],
	['mthi $t1', 'R', '000000 fffff 00000 00000 00000 010001'],
	['mtlo $t1', 'R', '000000 fffff 00000 00000 00000 010011'],
	['and $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 100100'],
	['or $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 100101'],
	['andi $t1,$t2,100', 'I', '001100 sssss fffff tttttttttttttttt'],
	['ori $t1,$t2,100', 'I', '001101 sssss fffff tttttttttttttttt'],
	['nor $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 100111'],
	['xor $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 100110'],
	['xori $t1,$t2,100', 'I', '001110 sssss fffff tttttttttttttttt'],
	['sll $t1,$t2,10', 'R', '000000 00000 sssss fffff ttttt 000000'],
	['sllv $t1,$t2,$t3', 'R', '000000 ttttt sssss fffff 00000 000100'],
	['srl $t1,$t2,10', 'R', '000000 00000 sssss fffff ttttt 000010'],
	['sra $t1,$t2,10', 'R', '000000 00000 sssss fffff ttttt 000011'],
	['srav $t1,$t2,$t3', 'R', '000000 ttttt sssss fffff 00000 000111'],
	['srlv $t1,$t2,$t3', 'R', '000000 ttttt sssss fffff 00000 000110'],
	['lw $t1,-100($t2)', 'I', '100011 ttttt fffff ssssssssssssssss'],
	['ll $t1,-100($t2)', 'I', '110000 ttttt fffff ssssssssssssssss'],
	['lwl $t1,-100($t2)', 'I', '100010 ttttt fffff ssssssssssssssss'],
	['lwr $t1,-100($t2)', 'I', '100110 ttttt fffff ssssssssssssssss'],
	['sw $t1,-100($t2)', 'I', '101011 ttttt fffff ssssssssssssssss'],
	['sc $t1,-100($t2)', 'I', '111000 ttttt fffff ssssssssssssssss'],
	['swl $t1,-100($t2)', 'I', '101010 ttttt fffff ssssssssssssssss'],
	['swr $t1,-100($t2)', 'I', '101110 ttttt fffff ssssssssssssssss'],
	['lui $t1,100', 'I', '001111 00000 fffff ssssssssssssssss'],
	['beq $t1,$t2,label', 'I-branch', '000100 fffff sssss tttttttttttttttt'],
	['bne $t1,$t2,label', 'I-branch', '000101 fffff sssss tttttttttttttttt'],
	['bgez $t1,label', 'I-branch', '000001 fffff 00001 ssssssssssssssss'],
	['bgezal $t1,label', 'I-branch', '000001 fffff 10001 ssssssssssssssss'],
	['bgtz $t1,label', 'I-branch', '000111 fffff 00000 ssssssssssssssss'],
	['blez $t1,label', 'I-branch', '000110 fffff 00000 ssssssssssssssss'],
	['bltz $t1,label', 'I-branch', '000001 fffff 00000 ssssssssssssssss'],
	['bltzal $t1,label', 'I-branch', '000001 fffff 10000 ssssssssssssssss'],
	['slt $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 101010'],
	['sltu $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 101011'],
	['slti $t1,$t2,-100', 'I', '001010 sssss fffff tttttttttttttttt'],
	['sltiu $t1,$t2,-100', 'I', '001011 sssss fffff tttttttttttttttt'],
	['movn $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 001011'],
	['movz $t1,$t2,$t3', 'R', '000000 sssss ttttt fffff 00000 001010'],
	['movf $t1,$t2', 'R', '000000 sssss 000 00 fffff 00000 000001'],
	['movf $t1,$t2,1', 'R', '000000 sssss ttt 00 fffff 00000 000001'],
	['movt $t1,$t2', 'R', '000000 sssss 000 01 fffff 00000 000001'],
	['movt $t1,$t2,1', 'R', '000000 sssss ttt 01 fffff 00000 000001'],
	['break 100', 'R', '000000 ffffffffffffffffffff 001101'],
	['break', 'R', '000000 00000 00000 00000 00000 001101'],
	['syscall', 'R', '000000 ccccc ccccc ccccc ccccc 001100'],
	['j target', 'J', '000010 ffffffffffffffffffffffffff'],
	['jr $t1', 'R', '000000 fffff 00000 00000 00000 001000'],
	['jal target', 'J', '000011 ffffffffffffffffffffffffff'],
	['jalr $t1,$t2', 'R', '000000 sssss 00000 fffff 00000 001001'],
	['jalr $t1', 'R', '000000 fffff 00000 11111 00000 001001'],
	['lb $t1,-100($t2)', 'I', '100000 ttttt fffff ssssssssssssssss'],
	['lh $t1,-100($t2)', 'I', '100001 ttttt fffff ssssssssssssssss'],
	['lhu $t1,-100($t2)', 'I', '100101 ttttt fffff ssssssssssssssss'],
	['lbu $t1,-100($t2)', 'I', '100100 ttttt fffff ssssssssssssssss'],
	['sb $t1,-100($t2)', 'I', '101000 ttttt fffff ssssssssssssssss'],
	['sh $t1,-100($t2)', 'I', '101001 ttttt fffff ssssssssssssssss'],
	['clo $t1,$t2', 'R', '011100 sssss 00000 fffff 00000 100001'],
	['clz $t1,$t2', 'R', '011100 sssss 00000 fffff 00000 100000'],
	['mfc0 $t1,$8', 'R', '010000 00000 fffff sssss 00000 000000'],
	['mtc0 $t1,$8', 'R', '010000 00100 fffff sssss 00000 000000'],
	['add.s $f0,$f1,$f3', 'R', '010001 10000 ttttt sssss fffff 000000'],
	['sub.s $f0,$f1,$f3', 'R', '010001 10000 ttttt sssss fffff 000001'],
	['mul.s $f0,$f1,$f3', 'R', '010001 10000 ttttt sssss fffff 000010'],
	['div.s $f0,$f1,$f3', 'R', '010001 10000 ttttt sssss fffff 000011'],
	['sqrt.s $f0,$f1', 'R', '010001 10000 00000 sssss fffff 000100'],
	['floor.w.s $f0,$f1', 'R', '010001 10000 00000 sssss fffff 001111'],
	['ceil.w.s $f0,$f1', 'R', '010001 10000 00000 sssss fffff 001110'],
	['round.w.s $f0,$f1', 'R', '010001 10000 00000 sssss fffff 001100'],
	['trunc.w.s $f0,$f1', 'R', '010001 10000 00000 sssss fffff 001101'],
	['add.d $f2,$f4,$f6', 'R', '010001 10001 ttttt sssss fffff 000000'],
	['sub.d $f2,$f4,$f6', 'R', '010001 10001 ttttt sssss fffff 000001'],
	['mul.d $f2,$f4,$f6', 'R', '010001 10001 ttttt sssss fffff 000010'],
	['div.d $f2,$f4,$f6', 'R', '010001 10001 ttttt sssss fffff 000011'],
	['sqrt.d $f2,$f4', 'R', '010001 10001 00000 sssss fffff 000100'],
	['floor.w.d $f1,$f2', 'R', '010001 10001 00000 sssss fffff 001111'],
	['ceil.w.d $f1,$f2', 'R', '010001 10001 00000 sssss fffff 001110'],
	['round.w.d $f1,$f2', 'R', '010001 10001 00000 sssss fffff 001100'],
	['trunc.w.d $f1,$f2', 'R', '010001 10001 00000 sssss fffff 001101'],
	['bc1t label', 'I-branch', '010001 01000 00001 ffffffffffffffff'],
	['bc1t 1,label', 'I-branch', '010001 01000 fff 01 ssssssssssssssss'],
	['bc1f label', 'I-branch', '010001 01000 00000 ffffffffffffffff'],
	['bc1f 1,label', 'I-branch', '010001 01000 fff 00 ssssssssssssssss'],
	['c.eq.s $f0,$f1', 'R', '010001 10000 sssss fffff 00000 110010'],
	['c.eq.s 1,$f0,$f1', 'R', '010001 10000 ttttt sssss fff 00 11 0010'],
	['c.le.s $f0,$f1', 'R', '010001 10000 sssss fffff 00000 111110'],
	['c.le.s 1,$f0,$f1', 'R', '010001 10000 ttttt sssss fff 00 111110'],
	['c.lt.s $f0,$f1', 'R', '010001 10000 sssss fffff 00000 111100'],
	['c.lt.s 1,$f0,$f1', 'R', '010001 10000 ttttt sssss fff 00 111100'],
	['c.eq.d $f2,$f4', 'R', '010001 10001 sssss fffff 00000 110010'],
	['c.eq.d 1,$f2,$f4', 'R', '010001 10001 ttttt sssss fff 00 110010'],
	['c.le.d $f2,$f4', 'R', '010001 10001 sssss fffff 00000 111110'],
	['c.le.d 1,$f2,$f4', 'R', '010001 10001 ttttt sssss fff 00 111110'],
	['c.lt.d $f2,$f4', 'R', '010001 10001 sssss fffff 00000 111100'],
	['c.lt.d 1,$f2,$f4', 'R', '010001 10001 ttttt sssss fff 00 111100'],
	['abs.s $f0,$f1', 'R', '010001 10000 00000 sssss fffff 000101'],
	['abs.d $f2,$f4', 'R', '010001 10001 00000 sssss fffff 000101'],
	['cvt.d.s $f2,$f1', 'R', '010001 10000 00000 sssss fffff 100001'],
	['cvt.d.w $f2,$f1', 'R', '010001 10100 00000 sssss fffff 100001'],
	['cvt.s.d $f1,$f2', 'R', '010001 10001 00000 sssss fffff 100000'],
	['cvt.s.w $f0,$f1', 'R', '010001 10100 00000 sssss fffff 100000'],
	['cvt.w.d $f1,$f2', 'R', '010001 10001 00000 sssss fffff 100100'],
	['cvt.w.s $f0,$f1', 'R', '010001 10000 00000 sssss fffff 100100'],
	['mov.d $f2,$f4', 'R', '010001 10001 00000 sssss fffff 000110'],
	['movf.d $f2,$f4', 'R', '010001 10001 000 00 sssss fffff 010001'],
	['movf.d $f2,$f4,1', 'R', '010001 10001 ttt 00 sssss fffff 010001'],
	['movt.d $f2,$f4', 'R', '010001 10001 000 01 sssss fffff 010001'],
	['movt.d $f2,$f4,1', 'R', '010001 10001 ttt 01 sssss fffff 010001'],
	['movn.d $f2,$f4,$t3', 'R', '010001 10001 ttttt sssss fffff 010011'],
	['movz.d $f2,$f4,$t3', 'R', '010001 10001 ttttt sssss fffff 010010'],
	['mov.s $f0,$f1', 'R', '010001 10000 00000 sssss fffff 000110'],
	['movf.s $f0,$f1', 'R', '010001 10000 000 00 sssss fffff 010001'],
	['movf.s $f0,$f1,1', 'R', '010001 10000 ttt 00 sssss fffff 010001'],
	['movt.s $f0,$f1', 'R', '010001 10000 000 01 sssss fffff 010001'],
	['movt.s $f0,$f1,1', 'R', '010001 10000 ttt 01 sssss fffff 010001'],
	['movn.s $f0,$f1,$t3', 'R', '010001 10000 ttttt sssss fffff 010011'],
	['movz.s $f0,$f1,$t3', 'R', '010001 10000 ttttt sssss fffff 010010'],
	['mfc1 $t1,$f1', 'R', '010001 00000 fffff sssss 00000 000000'],
	['mtc1 $t1,$f1', 'R', '010001 00100 fffff sssss 00000 000000'],
	['neg.d $f2,$f4', 'R', '010001 10001 00000 sssss fffff 000111'],
	['neg.s $f0,$f1', 'R', '010001 10000 00000 sssss fffff 000111'],
	['lwc1 $f1,-100($t2)', 'I', '110001 ttttt fffff ssssssssssssssss'],
	['ldc1 $f2,-100($t2)', 'I', '110101 ttttt fffff ssssssssssssssss'],
	['swc1 $f1,-100($t2)', 'I', '111001 ttttt fffff ssssssssssssssss'],
	['sdc1 $f2,-100($t2)', 'I', '111101 ttttt fffff ssssssssssssssss'],
	['teq $t1,$t2', 'R', '000000 fffff sssss ccccc ccccc 110100'],
	['teqi $t1,-100', 'I', '000001 fffff 01100 ssssssssssssssss'],
	['tne $t1,$t2', 'R', '000000 fffff sssss ccccc ccccc 110110'],
	['tnei $t1,-100', 'I', '000001 fffff 01110 ssssssssssssssss'],
	['tge $t1,$t2', 'R', '000000 fffff sssss ccccc ccccc 110000'],
	['tgeu $t1,$t2', 'R', '000000 fffff sssss ccccc ccccc 110001'],
	['tgei $t1,-100', 'I', '000001 fffff 01000 ssssssssssssssss'],
	['tgeiu $t1,-100', 'I', '000001 fffff 01001 ssssssssssssssss'],
	['tlt $t1,$t2', 'R', '000000 fffff sssss ccccc ccccc 110010'],
	['tltu $t1,$t2', 'R', '000000 fffff sssss ccccc ccccc 110011'],
	['tlti $t1,-100', 'I', '000001 fffff 01010 ssssssssssssssss'],
	['tltiu $t1,-100', 'I', '000001 fffff 01011 ssssssssssssssss'],
	['eret', 'R', '010000 1 0000000000000000000 011000'],
]

/**
 * FP operands rejected when odd, keyed by example, listing operand indices.
 * These are runtime checks rather than properties of the bit pattern, so they
 * are listed here: thirty forms in all.
 */
const EVEN_FP_OPERANDS: Readonly<Record<string, readonly number[]>> = {
	'add.d $f2,$f4,$f6': [0, 1, 2],
	'sub.d $f2,$f4,$f6': [0, 1, 2],
	'mul.d $f2,$f4,$f6': [0, 1, 2],
	'div.d $f2,$f4,$f6': [0, 1, 2],
	'sqrt.d $f2,$f4': [0, 1],
	'floor.w.d $f1,$f2': [1],
	'ceil.w.d $f1,$f2': [1],
	'round.w.d $f1,$f2': [1],
	'trunc.w.d $f1,$f2': [1],
	'c.eq.d $f2,$f4': [0, 1],
	'c.eq.d 1,$f2,$f4': [1, 2],
	'c.le.d $f2,$f4': [0, 1],
	'c.le.d 1,$f2,$f4': [1, 2],
	'c.lt.d $f2,$f4': [0, 1],
	'c.lt.d 1,$f2,$f4': [1, 2],
	'abs.d $f2,$f4': [0, 1],
	'cvt.d.s $f2,$f1': [0],
	'cvt.d.w $f2,$f1': [0],
	'cvt.s.d $f1,$f2': [1],
	'cvt.w.d $f1,$f2': [1],
	'mov.d $f2,$f4': [0, 1],
	'movf.d $f2,$f4': [0, 1],
	'movf.d $f2,$f4,1': [0, 1],
	'movt.d $f2,$f4': [0, 1],
	'movt.d $f2,$f4,1': [0, 1],
	'movn.d $f2,$f4,$t3': [0, 1],
	'movz.d $f2,$f4,$t3': [0, 1],
	'neg.d $f2,$f4': [0, 1],
	'ldc1 $f2,-100($t2)': [0],
	'sdc1 $f2,-100($t2)': [0],
}

/** Pseudo mnemonics whose FP operand names a double, so must be even-numbered. */
const DOUBLE_PSEUDO = new Set(['ldc1', 'sdc1', 'l.d', 's.d', 'mfc1.d', 'mtc1.d', 'li.d'])

/** `add $t1,$t2,$t3` as its mnemonic and its comma-separated operands. */
function splitExample(example: string): [string, string[]] {
	const space = example.indexOf(' ')
	if (space < 0) return [example, []]
	return [example.slice(0, space), example.slice(space + 1).split(',')]
}

/** 1 where the pattern fixes a bit. */
function deriveMask(pattern: string): number {
	return Number.parseInt(pattern.replace(/[01]/g, '1').replace(/[^01]/g, '0'), 2) >>> 0
}

/** The fixed bits' values. */
function deriveMatch(pattern: string): number {
	return Number.parseInt(pattern.replace(/[^1]/g, '0'), 2) >>> 0
}

/**
 * Each operand letter's bit range.  The substitution cannot express two runs
 * of one letter, so a non-contiguous run is a transcription error.
 */
function deriveFields(pattern: string): IsaField[] {
	const fields: IsaField[] = []
	for (const letter of ['f', 's', 't'] as const) {
		const first = pattern.indexOf(letter)
		if (first < 0) continue
		const last = pattern.lastIndexOf(letter)
		const width = last - first + 1
		if (pattern.slice(first, last + 1) !== letter.repeat(width)) {
			throw new Error(`${letter} is not one run in "${pattern}"`)
		}
		fields.push({ letter, shift: 31 - last, width })
	}
	return fields
}

/**
 * The kind of one basic operand.  The examples are consistent enough to read
 * directly: `-100` is a signed 16-bit immediate and `100` an unsigned one, `10`
 * a shift amount, `1` an FP condition code, and `$8` a CP0 register (it appears
 * only in `mfc0`/`mtc0`).
 */
function basicOperand(example: string, mnemonic: string, token: string, index: number): IsaOperandKind {
	if (/^-?\d*\(\$\w+\)$/.test(token)) return 'mem'
	if (/^\$f\d+$/.test(token)) return EVEN_FP_OPERANDS[example]?.includes(index) ? 'fpr-even' : 'fpr'
	if (/^\$\d+$/.test(token)) return 'cp0'
	if (/^\$\w+$/.test(token)) return 'gpr'
	if (token === 'label') return 'label'
	if (token === 'target') return 'target26'
	if (token === '1') return 'imm3'
	if (token === '10') return 'imm5'
	if (token === '100') return mnemonic === 'break' ? 'imm20' : 'imm16u'
	if (token === '-100') return 'imm16s'
	throw new Error(`Unrecognized operand "${token}" in "${example}"`)
}

/** The kind of one pseudo operand; the pseudo table adds the extended shapes. */
function pseudoOperand(example: string, mnemonic: string, token: string): IsaOperandKind {
	if (token === '($t2)') return 'base'
	if (/^-?\d+\(\$\w+\)$/.test(token)) return token.startsWith('100000') ? 'mem32' : 'mem'
	if (token === 'label($t2)') return 'label-mem'
	if (token === 'label+100000') return 'label-offset'
	if (token === 'label+100000($t2)') return 'label-offset-mem'
	if (token === 'label') return 'label'
	if (/^\$f\d+$/.test(token)) return DOUBLE_PSEUDO.has(mnemonic) ? 'fpr-even' : 'fpr'
	if (/^\$\w+$/.test(token)) return 'gpr'
	if (token === '1.5') return 'float'
	if (token === '10') return 'imm5'
	if (token === '100') return 'imm16u'
	if (token === '-100') return 'imm16s'
	if (token === '100000') return 'imm32'
	throw new Error(`Unrecognized operand "${token}" in "${example}"`)
}

/** The 155 basic forms, in table order. */
export const BASIC_INSTRUCTIONS: readonly BasicInstruction[] = BASIC_SOURCE.map(([example, format, spaced]) => {
	const pattern = spaced.replace(/ /g, '')
	const [mnemonic, tokens] = splitExample(example)
	return {
		mnemonic,
		operands: tokens.map((token, index) => basicOperand(example, mnemonic, token, index)),
		format,
		pattern,
		mask: deriveMask(pattern),
		match: deriveMatch(pattern),
		fields: deriveFields(pattern),
		example,
	}
})

/** The syntax of each pseudo form, in table order. */
const PSEUDO_SOURCE: readonly string[] = [
	'not $t1,$t2',
	'add $t1,$t2,-100',
	'add $t1,$t2,100000',
	'addu $t1,$t2,100000',
	'addi $t1,$t2,100000',
	'addiu $t1,$t2,100000',
	'sub $t1,$t2,-100',
	'sub $t1,$t2,100000',
	'subu $t1,$t2,100000',
	'subi $t1,$t2,-100',
	'subi $t1,$t2,100000',
	'subiu $t1,$t2,100000',
	'andi $t1,$t2,100000',
	'ori $t1,$t2,100000',
	'xori $t1,$t2,100000',
	'and $t1,$t2,100',
	'or $t1,$t2,100',
	'xor $t1,$t2,100',
	'and $t1,100',
	'or $t1,100',
	'xor $t1,100',
	'andi $t1,100',
	'ori $t1,100',
	'xori $t1,100',
	'andi $t1,100000',
	'ori $t1,100000',
	'xori $t1,100000',
	'seq $t1,$t2,$t3',
	'seq $t1,$t2,-100',
	'seq $t1,$t2,100000',
	'sne $t1,$t2,$t3',
	'sne $t1,$t2,-100',
	'sne $t1,$t2,100000',
	'sge $t1,$t2,$t3',
	'sge $t1,$t2,-100',
	'sge $t1,$t2,100000',
	'sgeu $t1,$t2,$t3',
	'sgeu $t1,$t2,-100',
	'sgeu $t1,$t2,100000',
	'sgt $t1,$t2,$t3',
	'sgt $t1,$t2,-100',
	'sgt $t1,$t2,100000',
	'sgtu $t1,$t2,$t3',
	'sgtu $t1,$t2,-100',
	'sgtu $t1,$t2,100000',
	'sle $t1,$t2,$t3',
	'sle $t1,$t2,-100',
	'sle $t1,$t2,100000',
	'sleu $t1,$t2,$t3',
	'sleu $t1,$t2,-100',
	'sleu $t1,$t2,100000',
	'move $t1,$t2',
	'abs $t1,$t2',
	'neg $t1,$t2',
	'negu $t1,$t2',
	'b label',
	'beqz $t1,label',
	'bnez $t1,label',
	'beq $t1,-100,label',
	'beq $t1,100000,label',
	'bne $t1,-100,label',
	'bne $t1,100000,label',
	'bge $t1,$t2,label',
	'bge $t1,-100,label',
	'bge $t1,100000,label',
	'bgeu $t1,$t2,label',
	'bgeu $t1,-100,label',
	'bgeu $t1,100000,label',
	'bgt $t1,$t2,label',
	'bgt $t1,-100,label',
	'bgt $t1,100000,label',
	'bgtu $t1,$t2,label',
	'bgtu $t1,-100,label',
	'bgtu $t1,100000,label',
	'ble $t1,$t2,label',
	'ble $t1,-100,label',
	'ble $t1,100000,label',
	'bleu $t1,$t2,label',
	'bleu $t1,-100,label',
	'bleu $t1,100000,label',
	'blt $t1,$t2,label',
	'blt $t1,-100,label',
	'blt $t1,100000,label',
	'bltu $t1,$t2,label',
	'bltu $t1,-100,label',
	'bltu $t1,100000,label',
	'rol $t1,$t2,$t3',
	'rol $t1,$t2,10',
	'ror $t1,$t2,$t3',
	'ror $t1,$t2,10',
	'mfc1.d $t1,$f2',
	'mtc1.d $t1,$f2',
	'mul $t1,$t2,-100',
	'mul $t1,$t2,100000',
	'mulu $t1,$t2,$t3',
	'mulu $t1,$t2,-100',
	'mulu $t1,$t2,100000',
	'mulo $t1,$t2,$t3',
	'mulo $t1,$t2,-100',
	'mulo $t1,$t2,100000',
	'mulou $t1,$t2,$t3',
	'mulou $t1,$t2,-100',
	'mulou $t1,$t2,100000',
	'div $t1,$t2,$t3',
	'div $t1,$t2,-100',
	'div $t1,$t2,100000',
	'divu $t1,$t2,$t3',
	'divu $t1,$t2,-100',
	'divu $t1,$t2,100000',
	'rem $t1,$t2,$t3',
	'rem $t1,$t2,-100',
	'rem $t1,$t2,100000',
	'remu $t1,$t2,$t3',
	'remu $t1,$t2,-100',
	'remu $t1,$t2,100000',
	'li $t1,-100',
	'li $t1,100',
	'li $t1,100000',
	'la $t1,($t2)',
	'la $t1,-100',
	'la $t1,100',
	'la $t1,100000',
	'la $t1,100($t2)',
	'la $t1,100000($t2)',
	'la $t1,label',
	'la $t1,label($t2)',
	'la $t1,label+100000',
	'la $t1,label+100000($t2)',
	'lw $t1,($t2)',
	'lw $t1,-100',
	'lw $t1,100',
	'lw $t1,100000',
	'lw $t1,100($t2)',
	'lw $t1,100000($t2)',
	'lw $t1,label',
	'lw $t1,label($t2)',
	'lw $t1,label+100000',
	'lw $t1,label+100000($t2)',
	'sw $t1,($t2)',
	'sw $t1,-100',
	'sw $t1,100',
	'sw $t1,100000',
	'sw $t1,100($t2)',
	'sw $t1,100000($t2)',
	'sw $t1,label',
	'sw $t1,label($t2)',
	'sw $t1,label+100000',
	'sw $t1,label+100000($t2)',
	'lh $t1,($t2)',
	'lh $t1,-100',
	'lh $t1,100',
	'lh $t1,100000',
	'lh $t1,100($t2)',
	'lh $t1,100000($t2)',
	'lh $t1,label',
	'lh $t1,label($t2)',
	'lh $t1,label+100000',
	'lh $t1,label+100000($t2)',
	'sh $t1,($t2)',
	'sh $t1,-100',
	'sh $t1,100',
	'sh $t1,100000',
	'sh $t1,100($t2)',
	'sh $t1,100000($t2)',
	'sh $t1,label',
	'sh $t1,label($t2)',
	'sh $t1,label+100000',
	'sh $t1,label+100000($t2)',
	'lb $t1,($t2)',
	'lb $t1,-100',
	'lb $t1,100',
	'lb $t1,100000',
	'lb $t1,100($t2)',
	'lb $t1,100000($t2)',
	'lb $t1,label',
	'lb $t1,label($t2)',
	'lb $t1,label+100000',
	'lb $t1,label+100000($t2)',
	'sb $t1,($t2)',
	'sb $t1,-100',
	'sb $t1,100',
	'sb $t1,100000',
	'sb $t1,100($t2)',
	'sb $t1,100000($t2)',
	'sb $t1,label',
	'sb $t1,label($t2)',
	'sb $t1,label+100000',
	'sb $t1,label+100000($t2)',
	'lhu $t1,($t2)',
	'lhu $t1,-100',
	'lhu $t1,100',
	'lhu $t1,100000',
	'lhu $t1,100($t2)',
	'lhu $t1,100000($t2)',
	'lhu $t1,label',
	'lhu $t1,label($t2)',
	'lhu $t1,label+100000',
	'lhu $t1,label+100000($t2)',
	'lbu $t1,($t2)',
	'lbu $t1,-100',
	'lbu $t1,100',
	'lbu $t1,100000',
	'lbu $t1,100($t2)',
	'lbu $t1,100000($t2)',
	'lbu $t1,label',
	'lbu $t1,label($t2)',
	'lbu $t1,label+100000',
	'lbu $t1,label+100000($t2)',
	'lwl $t1,($t2)',
	'lwl $t1,-100',
	'lwl $t1,100',
	'lwl $t1,100000',
	'lwl $t1,100($t2)',
	'lwl $t1,100000($t2)',
	'lwl $t1,label',
	'lwl $t1,label($t2)',
	'lwl $t1,label+100000',
	'lwl $t1,label+100000($t2)',
	'swl $t1,($t2)',
	'swl $t1,-100',
	'swl $t1,100',
	'swl $t1,100000',
	'swl $t1,100($t2)',
	'swl $t1,100000($t2)',
	'swl $t1,label',
	'swl $t1,label($t2)',
	'swl $t1,label+100000',
	'swl $t1,label+100000($t2)',
	'lwr $t1,($t2)',
	'lwr $t1,-100',
	'lwr $t1,100',
	'lwr $t1,100000',
	'lwr $t1,100($t2)',
	'lwr $t1,100000($t2)',
	'lwr $t1,label',
	'lwr $t1,label($t2)',
	'lwr $t1,label+100000',
	'lwr $t1,label+100000($t2)',
	'swr $t1,($t2)',
	'swr $t1,-100',
	'swr $t1,100',
	'swr $t1,100000',
	'swr $t1,100($t2)',
	'swr $t1,100000($t2)',
	'swr $t1,label',
	'swr $t1,label($t2)',
	'swr $t1,label+100000',
	'swr $t1,label+100000($t2)',
	'll $t1,($t2)',
	'll $t1,-100',
	'll $t1,100',
	'll $t1,100000',
	'll $t1,100($t2)',
	'll $t1,100000($t2)',
	'll $t1,label',
	'll $t1,label($t2)',
	'll $t1,label+100000',
	'll $t1,label+100000($t2)',
	'sc $t1,($t2)',
	'sc $t1,-100',
	'sc $t1,100',
	'sc $t1,100000',
	'sc $t1,100($t2)',
	'sc $t1,100000($t2)',
	'sc $t1,label',
	'sc $t1,label($t2)',
	'sc $t1,label+100000',
	'sc $t1,label+100000($t2)',
	'ulw $t1,-100($t2)',
	'ulh $t1,-100($t2)',
	'ulhu $t1,-100($t2)',
	'ld $t1,-100($t2)',
	'usw $t1,-100($t2)',
	'ush $t1,-100($t2)',
	'sd $t1,-100($t2)',
	'ulw $t1,100000',
	'ulw $t1,label',
	'ulw $t1,label+100000',
	'ulw $t1,($t2)',
	'ulw $t1,100000($t2)',
	'ulw $t1,label($t2)',
	'ulw $t1,label+100000($t2)',
	'ulh $t1,100000',
	'ulh $t1,label',
	'ulh $t1,label+100000',
	'ulh $t1,($t2)',
	'ulh $t1,100000($t2)',
	'ulh $t1,label($t2)',
	'ulh $t1,label+100000($t2)',
	'ulhu $t1,100000',
	'ulhu $t1,label',
	'ulhu $t1,label+100000',
	'ulhu $t1,($t2)',
	'ulhu $t1,100000($t2)',
	'ulhu $t1,label($t2)',
	'ulhu $t1,label+100000($t2)',
	'ld $t1,100000',
	'ld $t1,label',
	'ld $t1,label+100000',
	'ld $t1,($t2)',
	'ld $t1,100000($t2)',
	'ld $t1,label($t2)',
	'ld $t1,label+100000($t2)',
	'usw $t1,100000',
	'usw $t1,label',
	'usw $t1,label+100000',
	'usw $t1,($t2)',
	'usw $t1,100000($t2)',
	'usw $t1,label($t2)',
	'usw $t1,label+100000($t2)',
	'ush $t1,100000',
	'ush $t1,label',
	'ush $t1,label+100000',
	'ush $t1,($t2)',
	'ush $t1,100000($t2)',
	'ush $t1,label($t2)',
	'ush $t1,label+100000($t2)',
	'sd $t1,100000',
	'sd $t1,label',
	'sd $t1,label+100000',
	'sd $t1,($t2)',
	'sd $t1,100000($t2)',
	'sd $t1,label($t2)',
	'sd $t1,label+100000($t2)',
	'lwc1 $f1,($t2)',
	'lwc1 $f1,-100',
	'lwc1 $f1,100000',
	'lwc1 $f1,100000($t2)',
	'lwc1 $f1,label',
	'lwc1 $f1,label($t2)',
	'lwc1 $f1,label+100000',
	'lwc1 $f1,label+100000($t2)',
	'ldc1 $f2,($t2)',
	'ldc1 $f2,-100',
	'ldc1 $f2,100000',
	'ldc1 $f2,100000($t2)',
	'ldc1 $f2,label',
	'ldc1 $f2,label($t2)',
	'ldc1 $f2,label+100000',
	'ldc1 $f2,label+100000($t2)',
	'swc1 $f1,($t2)',
	'swc1 $f1,-100',
	'swc1 $f1,100000',
	'swc1 $f1,100000($t2)',
	'swc1 $f1,label',
	'swc1 $f1,label($t2)',
	'swc1 $f1,label+100000',
	'swc1 $f1,label+100000($t2)',
	'sdc1 $f2,($t2)',
	'sdc1 $f2,-100',
	'sdc1 $f2,100000',
	'sdc1 $f2,100000($t2)',
	'sdc1 $f2,label',
	'sdc1 $f2,label($t2)',
	'sdc1 $f2,label+100000',
	'sdc1 $f2,label+100000($t2)',
	'l.s $f1,($t2)',
	'l.s $f1,-100',
	'l.s $f1,100000',
	'l.s $f1,100000($t2)',
	'l.s $f1,label',
	'l.s $f1,label($t2)',
	'l.s $f1,label+100000',
	'l.s $f1,label+100000($t2)',
	's.s $f1,($t2)',
	's.s $f1,-100',
	's.s $f1,100000',
	's.s $f1,100000($t2)',
	's.s $f1,label',
	's.s $f1,label($t2)',
	's.s $f1,label+100000',
	's.s $f1,label+100000($t2)',
	'l.d $f2,($t2)',
	'l.d $f2,-100',
	'l.d $f2,100000',
	'l.d $f2,100000($t2)',
	'l.d $f2,label',
	'l.d $f2,label($t2)',
	'l.d $f2,label+100000',
	'l.d $f2,label+100000($t2)',
	's.d $f2,($t2)',
	's.d $f2,-100',
	's.d $f2,100000',
	's.d $f2,100000($t2)',
	's.d $f2,label',
	's.d $f2,label($t2)',
	's.d $f2,label+100000',
	's.d $f2,label+100000($t2)',
]

/**
 * The three forms this port adds, carrying `thraxExtension`: `bal` expands to
 * `jal` (`assembler.ts:547`), and `li.s`/`li.d`
 * load a float literal's bit pattern (`assembler.ts:631-639`).
 */
const THRAX_PSEUDO_SOURCE: readonly string[] = ['bal label', 'li.s $f1,1.5', 'li.d $f2,1.5']

function pseudoRecord(example: string): PseudoInstruction {
	const [mnemonic, tokens] = splitExample(example)
	return { mnemonic, operands: tokens.map((token) => pseudoOperand(example, mnemonic, token)), example }
}

/** The 388 pseudo forms, then the three extensions. */
export const PSEUDO_INSTRUCTIONS: readonly PseudoInstruction[] = [
	...PSEUDO_SOURCE.map(pseudoRecord),
	...THRAX_PSEUDO_SOURCE.map((example) => ({ ...pseudoRecord(example), thraxExtension: true as const })),
]

/** Mnemonic sets are upper case, since a mnemonic matches without regard to case. */
export const BASIC_MNEMONICS: ReadonlySet<string> =
	new Set(BASIC_INSTRUCTIONS.map((instruction) => instruction.mnemonic.toUpperCase()))

export const PSEUDO_MNEMONICS: ReadonlySet<string> =
	new Set(PSEUDO_INSTRUCTIONS.map((instruction) => instruction.mnemonic.toUpperCase()))

/**
 * Every mnemonic accepted: the basic and pseudo sets plus the three extras.
 * The union is what `lexer.isInstruction` reads; without them `bal`, `li.s`
 * and `li.d` would lex as identifiers.
 */
export const INSTRUCTION_MNEMONICS: ReadonlySet<string> =
	new Set([...BASIC_MNEMONICS, ...PSEUDO_MNEMONICS])

export function isInstructionMnemonic(word: string): boolean {
	return INSTRUCTION_MNEMONICS.has(word.toUpperCase())
}

/** Every basic form spelled with this mnemonic, in table order. */
export function basicForms(mnemonic: string): BasicInstruction[] {
	const wanted = mnemonic.toLowerCase()
	return BASIC_INSTRUCTIONS.filter((instruction) => instruction.mnemonic === wanted)
}

/** Every pseudo form spelled with this mnemonic, in table order. */
export function pseudoForms(mnemonic: string): PseudoInstruction[] {
	const wanted = mnemonic.toLowerCase()
	return PSEUDO_INSTRUCTIONS.filter((instruction) => instruction.mnemonic === wanted)
}

/** One mask's forms, keyed by their match value. */
interface MatchMap {
	mask: number
	/** Number of 1 bits in the mask, which is what orders the maps. */
	maskLength: number
	byMatch: Map<number, BasicInstruction>
}

function popcount(value: number): number {
	let count = 0
	for (let bits = value | 0; bits !== 0; count += 1) bits &= bits - 1
	return count
}

/**
 * Grouped by mask and ordered longest mask first, so the most constrained form
 * wins: `nop` over `sll`, bare `break` over `break 100`, and `movf $t1,$t2` over
 * `movf $t1,$t2,1`.  Masks compare as unsigned numbers, so a wider mask always
 * sorts first.
 */
function buildMatchMaps(): MatchMap[] {
	const byMask = new Map<number, MatchMap>()
	for (const instruction of BASIC_INSTRUCTIONS) {
		let map = byMask.get(instruction.mask)
		if (!map) {
			map = { mask: instruction.mask, maskLength: popcount(instruction.mask), byMatch: new Map() }
			byMask.set(instruction.mask, map)
		}
		map.byMatch.set(instruction.match, instruction)
	}
	return [...byMask.values()].sort((left, right) =>
		right.maskLength - left.maskLength || ((left.mask | 0) - (right.mask | 0)))
}

const MATCH_MAPS = buildMatchMaps()

/** The form a machine word encodes, or undefined; `InstructionSet.findByBinaryCode`. */
export function findByBinary(word: number): BasicInstruction | undefined {
	for (const map of MATCH_MAPS) {
		const found = map.byMatch.get((word & map.mask) >>> 0)
		if (found) return found
	}
	return undefined
}
