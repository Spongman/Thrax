/**
 * The MIPS Mandelbrot example's picture (src/architectures/mips/examples/
 * mandelbrot.asm, single precision, SIZE 32, 16 iterations), recorded from
 * the MIPS simulator as each pixel's iteration count in base 17: g (16)
 * never escaped. The ARM floating-point versions must draw it exactly.
 */

export const MIPS_MANDELBROT: readonly string[] = [
	'11111122222223333333333333222222',
	'11111222222333333333334443333222',
	'11111222233333333334445965443332',
	'111122233333333333444557b8544333',
	'111222333333333344444568d9654433',
	'1112233333333334444456adgcc55443',
	'1112333333333344445667aggg965544',
	'1123333333333444557989bggga86694',
	'112333333334445557ggcgggggggabc7',
	'123333333344555567bgggggggggggg6',
	'12333333445555667gggggggggggggb7',
	'13333444578777778fggggggggggggga',
	'1334444568febgb9aggggggggggggggg',
	'1344445567dgggggegggggggggggggge',
	'144445568aggggggggggggggggggggg9',
	'15556679ggggggggggggggggggggggg6',
	'gggggggggggggggggggggggggggggg96',
	'15556679ggggggggggggggggggggggg6',
	'144445568aggggggggggggggggggggg9',
	'1344445567dgggggegggggggggggggge',
	'1334444568febgb9aggggggggggggggg',
	'13333444578777778fggggggggggggga',
	'12333333445555667gggggggggggggb7',
	'123333333344555567bgggggggggggg6',
	'112333333334445557ggcgggggggabc7',
	'1123333333333444557989bggga86694',
	'1112333333333344445667aggg965544',
	'1112233333333334444456adgcc55443',
	'111222333333333344444568d9654433',
	'111122233333333333444557b8544333',
	'11111222233333333334445965443332',
	'11111222222333333333334443333222',
]

export const MANDELBROT_PALETTE: readonly number[] = [
	0x000030, 0x00104a, 0x001f66, 0x003080, 0x0044a0, 0x0059bd, 0x1a72d4, 0x3d8ce0,
	0x62a6ea, 0x86bff2, 0xa8d5f7, 0xc6e6fb, 0xdef1fd, 0xeff8fe, 0xf8fcff, 0xffffff, 0x000000,
]

/** Iteration counts, row by row, from the recorded picture. */
export const mipsMandelbrotCounts = (): number[] => MIPS_MANDELBROT.flatMap((row) => [...row].map((digit) => parseInt(digit, 17)))

/** The MIPS program's arithmetic in JS: each operation rounded to single once, as the hardware does. */
export function modelMandelbrotCounts(): number[] {
	const f = Math.fround
	const step = f(f(2.5) / 32)
	const counts: number[] = []
	for (let row = 0; row < 32; row++) {
		const cy = f(f(row * step) + f(-1.25))
		for (let column = 0; column < 32; column++) {
			const cx = f(f(column * step) + f(-2))
			let zx = 0
			let zy = 0
			let iteration = 0
			while (iteration < 16) {
				const zx2 = f(zx * zx)
				const zy2 = f(zy * zy)
				if (f(zx2 + zy2) > 4) break
				zy = f(f(f(zx * zy) * 2) + cy)
				zx = f(f(zx2 - zy2) + cx)
				iteration++
			}
			counts.push(iteration)
		}
	}
	return counts
}
