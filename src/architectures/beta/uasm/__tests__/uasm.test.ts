import { describe, expect, it } from 'vitest'
import { assembleUasm, betaLibrary } from '../index'

// Expected bytes are computed by hand from the beta.pdf field layout:
// opcode[31:26] Rc[25:21] Ra[20:16] Rb[15:11] | literal[15:0], stored little-endian.

function assemble(code: string, files: { name: string; code: string }[] = []) {
	return assembleUasm({ name: 'main.uasm', code }, { files })
}

function bytes(code: string, withLibrary = true): number[] {
	const result = assemble(withLibrary ? `.include "beta.uasm"\n${code}` : code)
	expect(result.diagnostics).toEqual([])
	const out: number[] = []
	for (const section of result.image!.sections) {
		while (out.length < section.address) out.push(0)
		out.push(...section.bytes)
	}
	return out
}

function word(value: number): number[] {
	return [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, value >>> 24]
}

function error(code: string, files: { name: string; code: string }[] = []) {
	const result = assemble(code, files)
	expect(result.image).toBeNull()
	return result.diagnostics[0]
}

describe('UASM expressions and layout', () => {
	it('emits bytes from whitespace-separated expressions', () => {
		expect(bytes('14 15 0b10000 0x11 3*6 20-1', false)).toEqual([14, 15, 16, 17, 18, 19])
	})

	it('evaluates left to right without precedence, as BSim documents', () => {
		expect(bytes('37+0b10-0x10  24-0x1  4*0b110-1  0xF7%0x20  1+2*3', false)).toEqual([23, 23, 23, 23, 9])
	})

	it('reads octal, character constants and escapes', () => {
		expect(bytes('010 \'a\' \'\\n\' \'\\101\'', false)).toEqual([8, 97, 10, 65])
	})

	it('assigns symbols and reads them back', () => {
		expect(bytes('X = 2\nY = X+1\nZ = X*Y\nX+X+Y Z', false)).toEqual([7, 6])
	})

	it('moves the location counter and binds labels to it', () => {
		const result = assemble('. = 0x100\n1 2 3 4\nfive = .\nfive: 5 6 7 8\n. = .+16\nnine: 9')
		expect(result.diagnostics).toEqual([])
		const image = result.image!
		expect(image.sections.map((section) => [section.address, [...section.bytes]])).toEqual([
			[0x100, [1, 2, 3, 4, 5, 6, 7, 8]],
			[0x118, [9]],
		])
		expect(image.symbols).toEqual([{ name: 'five', address: 0x104 }, { name: 'nine', address: 0x118 }])
	})

	it('reproduces the BSim documentation table of squares', () => {
		const out = bytes('. = 0x1000\nsqrs: 0 1 4 9\n16 25 36 49\n64 81 100 121\n144 169 196 225\nslen: LONG(. - sqrs)')
		expect(out.slice(0x1010)).toEqual([0x10, 0, 0, 0])
	})

	it('aligns, and pads .text to a word', () => {
		expect(bytes('1 .align\n2 .align 2\n.ascii "a\\n"\n.text "hi"\n3', false))
			.toEqual([1, 0, 0, 0, 2, 0, 0x61, 0x0A, 0x68, 0x69, 0, 0, 3])
	})

	it('accepts block comments spanning lines', () => {
		expect(bytes('1 /* two\nthree */ 4 // five', false)).toEqual([1, 4])
	})
})

describe('UASM macros', () => {
	it('overloads by argument count', () => {
		expect(bytes('.macro M(a) a\n.macro M(a, b) a b b\nM(1) M(2, 3)', false)).toEqual([1, 2, 3, 3])
	})

	it('keeps assignments and labels inside a macro local', () => {
		const result = assemble('x = 1\n.macro M() { x = 9\ninner: x }\nM() x')
		expect(result.diagnostics).toEqual([])
		expect([...result.image!.sections[0].bytes]).toEqual([9, 1])
		expect(result.image!.symbols).toEqual([])
	})
})

describe('Beta instruction encodings', () => {
	it('ADD(R1,R2,R3) = 0x80611000', () => {
		expect(bytes('ADD(R1,R2,R3)')).toEqual(word(0x80611000))
	})

	it('ADDC(R1,-1,R3) = 0xC061FFFF', () => {
		expect(bytes('ADDC(R1,-1,R3)')).toEqual(word(0xC061FFFF))
	})

	it('ADDC(R31,-3,R1) = 0xC03FFFFD, as in the course notes', () => {
		expect(bytes('ADDC(R31,-3,R1)')).toEqual([0xFD, 0xFF, 0x3F, 0xC0])
	})

	it('ST(R1,0x10,R2) = 0x64220010 and RTN() = 0x6FFC0000', () => {
		expect(bytes('ST(R1,0x10,R2) RTN()')).toEqual([...word(0x64220010), ...word(0x6FFC0000)])
	})

	it('BEQ to a forward label', () => {
		// literal = (8 - 0)/4 - 1 = 1
		expect(bytes('BEQ(R1, target, R2)\nHALT()\ntarget: HALT()').slice(0, 4)).toEqual(word(0x70410001))
	})

	it('BNE to a backward label', () => {
		// literal = (0 - 4)/4 - 1 = -2
		expect(bytes('loop: HALT()\nBNE(R1, loop)').slice(4)).toEqual(word(0x77E1FFFE))
	})

	it('BR uses R31 for both registers', () => {
		expect(bytes('BR(next)\nHALT()\nnext:').slice(0, 4)).toEqual(word(0x73FF0001))
	})

	it('LDR addresses PC-relative data', () => {
		// literal = (8 - 0)/4 - 1 = 1; Ra field is R31
		expect(bytes('LDR(data, R5)\nHALT()\ndata: LONG(0x12345678)'))
			.toEqual([...word(0x7CBF0001), ...word(0), 0x78, 0x56, 0x34, 0x12])
	})

	it('WORD and LONG are little-endian 32-bit, SHORT 16-bit', () => {
		expect(bytes('WORD(0xdeadbeef) LONG(-2) SHORT(0x1234)'))
			.toEqual([0xEF, 0xBE, 0xAD, 0xDE, 0xFE, 0xFF, 0xFF, 0xFF, 0x34, 0x12])
	})

	it('PUSH expands to two instructions', () => {
		expect(bytes('PUSH(R1)')).toEqual([...word(0xC3BD0004), ...word(0x643DFFFC)])
	})

	it('aligns an instruction that follows odd data', () => {
		expect(bytes('7 HALT()')).toEqual([7, 0, 0, 0, 0, 0, 0, 0])
	})
})

describe('UASM source mapping', () => {
	it('maps macro-emitted instructions to the invocation line with the expansion chain', () => {
		const result = assemble('.include "beta.uasm"\nstart:\n\tPUSH(R1)\n\tLONG(7)')
		expect(result.diagnostics).toEqual([])
		const mappings = result.image!.sourceMappings
		expect(mappings.map(({ address, byteLength, kind, source }) => ({ address, byteLength, kind, line: source.line, file: source.file }))).toEqual([
			{ address: 0, byteLength: 4, kind: 'instruction', line: 3, file: 'main.uasm' },
			{ address: 4, byteLength: 4, kind: 'instruction', line: 3, file: 'main.uasm' },
			{ address: 8, byteLength: 4, kind: 'data', line: 4, file: 'main.uasm' },
		])
		const definitionLine = betaLibrary.code.split('\n').findIndex((line) => line.startsWith('.macro betaopc(')) + 1
		const chain = mappings[1].expansion
		expect(chain.map((frame) => frame.macro)).toEqual(['PUSH', 'ST', 'betaopc'])
		expect(chain[0].invocation).toEqual({ file: 'main.uasm', line: 3, column: 2 })
		expect(chain[2].definition).toMatchObject({ file: betaLibrary.name, line: definitionLine })
		expect(result.image!.symbols).toEqual([{ name: 'start', address: 0 }])
		expect(result.image!.entryAddress).toBe(0)
	})
})

describe('UASM includes', () => {
	it('resolves workspace files relative to the includer, then bundled libraries by name', () => {
		const result = assemble('.include "/shared/bsim/beta.uasm"\n.include "lib/defs.uasm"\nLONG(K)', [
			{ name: 'lib/defs.uasm', code: '.include "more.uasm"' },
			{ name: 'lib/more.uasm', code: 'K = 5' },
		])
		expect(result.diagnostics).toEqual([])
		expect([...result.image!.sections[0].bytes]).toEqual([5, 0, 0, 0])
	})

	it('records BSim directives for the machine profile', () => {
		const result = assemble('.options tty noclk\n1 .breakpoint 2 .protect 3 .unprotect')
		expect(result.diagnostics).toEqual([])
		expect(result.directives).toEqual({ breakpoints: [1], protection: [{ start: 2, end: 3 }], options: { tty: true, clock: false } })
	})
})

describe('UASM diagnostics', () => {
	it('reports an undefined symbol at its use', () => {
		expect(error('.include "beta.uasm"\nADD(R1, nowhere, R3)'))
			.toMatchObject({ message: expect.stringContaining('Symbol \'nowhere\' is undefined'), file: 'main.uasm', line: 2, column: 9 })
	})

	it('reports a call with the wrong number of arguments', () => {
		expect(error('.include "beta.uasm"\nADD(R1, R2)'))
			.toMatchObject({ message: expect.stringContaining('Macro \'ADD\' not defined for 2 arguments'), line: 2, column: 1 })
	})

	it('reports an undefined macro', () => {
		expect(error('NOPE(1)')).toMatchObject({ message: expect.stringContaining('Macro \'NOPE\' has not been defined'), line: 1 })
	})

	it('reports recursive includes', () => {
		expect(error('.include "a.uasm"', [
			{ name: 'a.uasm', code: '\n.include "b.uasm"' },
			{ name: 'b.uasm', code: '.include "a.uasm"' },
		])).toMatchObject({ message: expect.stringContaining('Recursive include of a.uasm: a.uasm -> b.uasm -> a.uasm'), file: 'b.uasm', line: 1 })
	})

	it('reports a missing include', () => {
		expect(error('.include "missing.uasm"')).toMatchObject({ message: expect.stringContaining('File not found: missing.uasm'), line: 1 })
	})

	it('bounds recursive macro expansion and reports it at the invocation', () => {
		expect(error('.macro f(x) f(x)\n\nf(1)'))
			.toMatchObject({ message: expect.stringContaining('Macro expansion exceeds 256 levels'), line: 3 })
	})

	it('reports a fault inside a macro body at the outermost invocation', () => {
		const diagnostic = error('.macro BIG() 300\nBIG()')
		expect(diagnostic).toMatchObject({ line: 2, column: 1 })
		expect(diagnostic.message).toContain('300 is too large at main.uasm:1:14 (expanding BIG)')
	})

	it('rejects bytes outside -128..255', () => {
		expect(error('256')).toMatchObject({ message: expect.stringContaining('256 is too large') })
		expect(error('-129')).toMatchObject({ message: expect.stringContaining('-129 is too negative') })
	})

	it('rejects moving the location counter backwards', () => {
		expect(error('. = 8\n. = 4')).toMatchObject({ message: expect.stringContaining('lower than its current value'), line: 2 })
	})

	it('requires origins to be known during layout', () => {
		expect(error('. = later\nlater:')).toMatchObject({ message: expect.stringContaining('Symbol \'later\' is undefined'), line: 1 })
	})

	it('rejects macro redefinition with the same arity', () => {
		expect(error('.macro M(a) a\n.macro M(b) b')).toMatchObject({ message: expect.stringContaining('Redefinition of 1-argument macro M'), line: 2 })
	})

	it('rejects unknown and unsupported directives', () => {
		expect(error('.foo')).toMatchObject({ message: expect.stringContaining('Unrecognised directive \'.foo\'') })
		expect(error('.segment')).toMatchObject({ message: expect.stringContaining('.segment expects a segment name') })
	})

	it('reports lexical and syntax errors with columns', () => {
		expect(error('1 0x 2')).toMatchObject({ message: expect.stringContaining('Incomprehensible number 0x'), line: 1, column: 3 })
		expect(error('.macro M( { }')).toMatchObject({ message: expect.stringContaining('Macro arguments must be valid symbol names') })
		expect(error('M(1')).toMatchObject({ message: expect.stringContaining('expecting \',\' or \')\'') })
		expect(error('1 / 0')).toMatchObject({ message: expect.stringContaining('Division by zero') })
		expect(error('.macro M() {\n1')).toMatchObject({ message: expect.stringContaining('Expected closing brace'), line: 1 })
	})
})

describe('UASM segments and BSim directives', () => {
	const SEGMENTED = `.include "beta.uasm"
.options segmentation
x = 7
	LONG(P_base) LONG(P_bounds) LONG(Q_base) LONG(kernel_bounds)
	.breakpoint
	LONG(x)
.segment P
. = 0
here:	LONG(here) LONG(.) LONG(x)
	.breakpoint
	LONG(SEG_BASE)
	BR(here)
.segment Q
here:	LONG(here) LONG(P_base)
`

	it('assembles each segment from virtual 0 at the next physical word, with base and bounds', () => {
		const result = assemble(SEGMENTED)
		expect(result.diagnostics).toEqual([])
		expect(result.directives.options.segmentation).toBe(true)
		// Kernel: 5 words; P: 5 words from 20; Q: 2 words from 40.
		expect(bytes(SEGMENTED, false)).toEqual([
			...word(20), ...word(20), ...word(40), ...word(20), ...word(7),
			...word(0), ...word(4), ...word(7), ...word(-4), ...word(0x73FFFFFB),
			...word(0), ...word(20),
		])
		expect(result.values.get('P_base')).toBe(20)
		expect(result.values.get('Q_bounds')).toBe(8)
		// Labels are physical; a name two parts share is qualified.
		expect(result.image!.symbols).toEqual([
			{ name: 'P:here', address: 20, scope: 'P' },
			{ name: 'Q:here', address: 40, scope: 'Q' },
		])
		expect(result.directives.breakpoints).toEqual([16, 32])
		expect(result.image!.sourceMappings.find((mapping) => mapping.source.line === 9)?.address).toBe(20)
	})

	it('skips checkoff directives', () => {
		expect(bytes('.pcheckoff "jsinput" "Tiny OS" 36036\n.verify 0 0\n.tcheckoff "x" "y" 1\n1', false)).toEqual([1])
	})

	it('rejects a segment inside a macro', () => {
		expect(error('.macro M() {\n.segment S\n}\nM()')).toMatchObject({ message: expect.stringContaining('.segment cannot be used inside a macro') })
	})
})
