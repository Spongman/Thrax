import { describe, expect, it } from 'vitest'
import { Assembler, type SourceFile } from '../assembler'
import { firstError } from '../diagnostics'

/** Assembles every file in its own right, as the multi-file mode does. */
function assembleAll(files: SourceFile[]) {
	return new Assembler(files, files.map((file) => file.name)).assemble()
}

function errorOf(files: SourceFile[]): string {
	const error = firstError(assembleAll(files).diagnostics)
	expect(error, 'expected an assembly error').toBeDefined()
	return error!.message
}

function ok(files: SourceFile[]) {
	const result = assembleAll(files)
	expect(firstError(result.diagnostics)?.message).toBeUndefined()
	return result
}

describe('where a name is written', () => {
	it("is the label's own line, not the line of the word it names", () => {
		const { program } = ok([{
			name: 'a.asm',
			code: '\t.data\ncount:\t.word 1\n\t.text\nmain:\n\n\tj main\nend:\tj end\n',
		}])

		const sites = program.symbolSites.get('a.asm')
		// `main:` is on line 4; the instruction it names is on line 6.
		expect(sites?.get('main')).toEqual({ file: 'a.asm', line: 4 })
		expect(program.sourceIndex.lineForAddress(program.symbols.locals.get('a.asm')!.get('main')!)?.line).toBe(6)
		// A label sharing its line with what it names is on that line either way.
		expect(sites?.get('end')).toEqual({ file: 'a.asm', line: 7 })
		expect(sites?.get('count')).toEqual({ file: 'a.asm', line: 2 })
	})

	it("keeps each unit's own names apart, and an extern where it is declared", () => {
		const { program } = ok([
			{ name: 'a.asm', code: '\t.extern shared, 4\nloop:\n\tj loop\n' },
			{ name: 'b.asm', code: '\n\nloop:\n\tj loop\n' },
		])

		expect(program.symbolSites.get('a.asm')?.get('loop')?.line).toBe(2)
		expect(program.symbolSites.get('b.asm')?.get('loop')?.line).toBe(3)
		expect(program.symbolSites.get('a.asm')?.get('shared')).toEqual({ file: 'a.asm', line: 1 })
	})
})

describe('symbols are scoped to the file that defines them', () => {
	it('lets two files each define the same name', () => {
		const { program } = ok([
			{ name: 'a.asm', code: 'main:\nloop:\n\tj loop\n' },
			{ name: 'b.asm', code: 'loop:\n\tj loop\n' },
		])

		// One name, two addresses, because neither file can see the other's.
		expect(program.symbols.locals.get('a.asm')?.get('loop')).toBe(0x00400000)
		expect(program.symbols.locals.get('b.asm')?.get('loop')).toBe(0x00400004)
		expect(program.symbols.globals.size).toBe(0)
	})

	it('refuses a name another file keeps to itself', () => {
		expect(errorOf([
			{ name: 'a.asm', code: 'main:\n\tjal helper\n' },
			{ name: 'b.asm', code: 'helper:\n\tjr $ra\n' },
		])).toBe('Undefined label: helper at a.asm:2:2')
	})

	it('resolves a name the defining file declares global', () => {
		const { program } = ok([
			{ name: 'a.asm', code: 'main:\n\tjal helper\n' },
			{ name: 'b.asm', code: '\t.globl helper\nhelper:\n\tjr $ra\n' },
		])

		// The move is out of the local table, not a copy into both.
		expect(program.symbols.globals.get('helper')).toBe(0x00400004)
		expect(program.symbols.locals.get('b.asm')?.has('helper')).toBe(false)
		expect(program.instructions[0].args[0]).toMatchObject({ address: 0x00400004 })
	})

	it('rejects a global its own file never defines', () => {
		expect(errorOf([
			{ name: 'a.asm', code: '\t.globl helper\nmain:\n\tnop\n' },
			{ name: 'b.asm', code: 'helper:\n\tjr $ra\n' },
		])).toBe('Global label is not defined in this file: helper at a.asm:1:2')
	})

	it('rejects the same global in two files', () => {
		expect(errorOf([
			{ name: 'a.asm', code: '\t.globl shared\nshared:\n\tnop\n' },
			{ name: 'b.asm', code: '\t.globl shared\nshared:\n\tnop\n' },
		])).toBe('Global label is already defined in another file: shared at b.asm:1:2')
	})

	it("keeps an included file's labels in the includer", () => {
		const { program } = ok([
			{ name: 'main.asm', code: 'main:\n\tjal helper\n\t.include "lib.asm"\n' },
			{ name: 'lib.asm', code: 'helper:\n\tjr $ra\n' },
		])

		// `lib.asm` is spliced into `main.asm`, so `helper` is main.asm's own.
		expect(program.symbols.locals.get('main.asm')?.get('helper')).toBe(0x00400004)
		expect(program.symbols.locals.has('lib.asm')).toBe(false)
	})
})

describe('data operands resolve in their own file', () => {
	it('stores the address of a global, and refuses a local one', () => {
		const shared = { name: 'b.asm', code: '\t.globl value\n\t.data\nvalue:\t.word 7\n' }
		const { program } = ok([
			{ name: 'a.asm', code: '\t.data\nhere:\t.word value\n\t.text\nmain:\tnop\n' },
			shared,
		])

		const entry = program.data.find((item) => item.sourceFile === 'a.asm')!
		expect(entry.bytes[0]).toMatchObject({ value: { type: 'immediate', value: 0x10010004 } })

		expect(errorOf([
			{ name: 'a.asm', code: '\t.data\nhere:\t.word value\n\t.text\nmain:\tnop\n' },
			{ name: 'b.asm', code: '\t.data\nvalue:\t.word 7\n' },
		])).toBe('Undefined label: value at a.asm:2')
	})
})

describe('.extern', () => {
	it('names storage every file can see', () => {
		const { program } = ok([
			{ name: 'a.asm', code: '\t.extern buffer, 8\nmain:\tla $t0, buffer\n' },
			{ name: 'b.asm', code: '\tla $t1, buffer\n' },
		])

		expect(program.symbols.globals.get('buffer')).toBe(0x10000000)
		expect(program.symbols.locals.get('a.asm')?.has('buffer')).toBe(false)
	})
})
