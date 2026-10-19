import { describe, expect, it } from 'vitest'
import { assembleMips, tokenizeFiles, type SourceFile } from '../../assembler'
import { firstError } from '../../../../core/diagnostics'

function assembleFiles(files: SourceFile[], entry: string) {
	return assembleMips(files, [entry])
}

function errorOf(files: SourceFile[], entry: string): string {
	const error = firstError(assembleFiles(files, entry).diagnostics)
	expect(error, 'expected an assembly error').toBeDefined()
	return error!.message
}

/**
 * MARS resolves an include relative to the includer's directory and reports a
 * cycle, direct or indirect (`Tokenizer.processIncludes`,
 * `mars/assembler/Tokenizer.java:136-147`).  A browser has no directories, so
 * THRAX matches on tab title instead; the cycle report is the part that carries
 * over.
 */
describe('.include', () => {
	it('retains included source locations and the includer translation unit', () => {
		const files = [
			{ name: 'main.asm', code: '.include "dir/HEADER.ASM"\nnop' },
			{ name: 'header.asm', code: 'add $t0,$t1,$t2' },
		]
		const tokens = tokenizeFiles(files, [files[0]])
		expect(tokens.find((token) => token.value === 'add')).toMatchObject({ file: 'header.asm', unit: 'main.asm', line: 1 })
		expect(tokens.filter((token) => token.type === 'EOF')).toHaveLength(1)
		expect(assembleMips(files, ['main.asm']).machineCode).toHaveLength(2)
	})

	it('retains positioned missing-target and malformed-include diagnostics', () => {
		expect(errorOf([{ name: 'main.asm', code: '.include "missing.asm"' }], 'main.asm'))
			.toBe('Cannot include "missing.asm"; open files are: main.asm at main.asm:1:1')
		expect(errorOf([{ name: 'main.asm', code: '.include' }], 'main.asm'))
			.toBe('.include expects a file name at main.asm:1:1')
	})

	it('deduplicates an included file that is also an assembly entry', () => {
		const result = assembleMips([
			{ name: 'main.asm', code: '.include "header.asm"\nnop' },
			{ name: 'header.asm', code: 'nop' },
		])
		expect(result.diagnostics).toEqual([])
		expect(result.machineCode).toHaveLength(2)
	})

	it('reports a file that includes itself', () => {
		const files = [{ name: 'a.asm', code: '.include "a.asm"\nnop\n' }]
		expect(errorOf(files, 'a.asm')).toBe('Recursive include of file a.asm: a.asm -> a.asm at a.asm:1:1')
	})

	it('reports a cycle through another file', () => {
		const files = [
			{ name: 'a.asm', code: '.include "b.asm"\nnop\n' },
			{ name: 'b.asm', code: '.include "a.asm"\nnop\n' },
		]
		expect(errorOf(files, 'a.asm')).toBe('Recursive include of file a.asm: a.asm -> b.asm -> a.asm at b.asm:1:1')
	})

	/**
	 * MARS would call this recursive too, since its `inclFiles` map is never
	 * unwound.  THRAX splices a file at most once per assembly instead, which is
	 * what makes the second include of `common.asm` harmless rather than an
	 * error, and keeps a shared header usable.
	 */
	it('assembles a diamond, where two files include a third', () => {
		const files = [
			{ name: 'main.asm', code: '.include "left.asm"\n.include "right.asm"\njal shared\n' },
			{ name: 'left.asm', code: '.include "common.asm"\nleft: jr $ra\n' },
			{ name: 'right.asm', code: '.include "common.asm"\nright: jr $ra\n' },
			{ name: 'common.asm', code: 'shared: jr $ra\n' },
		]
		const { diagnostics, machineCode } = assembleFiles(files, 'main.asm')
		expect(diagnostics).toEqual([])
		// `shared`, `left`, `right`, `jal` — the common file spliced once.
		expect(machineCode).toHaveLength(4)
	})
})
