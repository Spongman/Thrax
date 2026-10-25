import type { CpuContext } from '../../core/configuredCpu'

export const A = 0, B = 1, X = 2, SP = 3, CC = 4, Y = 5, U = 6, DP = 7, D = 8
export const C = 1, V = 2, Z = 4, N = 8, I = 16, H = 32

export const getD = (c: CpuContext) => c.r[A] << 8 | c.r[B]
export function setD(c: CpuContext, value: number) { c.r[A] = value >>> 8 & 255; c.r[B] = value & 255 }
export const readWord = (c: CpuContext, at: number) => c.read(at & 65535) << 8 | c.read(at + 1 & 65535)
export function writeWord(c: CpuContext, at: number, value: number) { c.write(at & 65535, value >>> 8); c.write(at + 1 & 65535, value & 255) }
export function arithmetic16(c: CpuContext, left: number, right: number, subtract: boolean) {
	const result = subtract ? left - right : left + right
	flag(c, C, subtract ? result < 0 : result > 65535)
	flag(c, V, !!((subtract ? left ^ right : ~(left ^ right)) & (left ^ result) & 0x8000))
	return nz(c, result, 16)
}
/** The branch condition pairs are identical across the Motorola variants. */
export function branchCondition(c: CpuContext, condition: number): boolean {
	const f = c.r[CC], carry = !!(f & C), zero = !!(f & Z), negative = !!(f & N), overflow = !!(f & V)
	let result: boolean
	switch (condition >>> 1) {
		case 0: result = true; break
		case 1: result = !carry && !zero; break
		case 2: result = !carry; break
		case 3: result = !zero; break
		case 4: result = !overflow; break
		case 5: result = !negative; break
		case 6: result = negative === overflow; break
		default: result = !zero && negative === overflow
	}
	return condition & 1 ? !result : result
}

export function flag(c: CpuContext, mask: number, on: boolean): void { c.r[CC] = (c.r[CC] & ~mask | (on ? mask : 0)) & 255 }
export function nz(c: CpuContext, n: number, bits = 8): number { const mask = bits === 8 ? 255 : 65535, v = n & mask; flag(c, Z, v === 0); flag(c, N, !!(v & (1 << bits - 1))); return v }
export function arithmetic(c: CpuContext, left: number, right: number, subtract: boolean, carry = 0): number {
	const result = subtract ? left - right - carry : left + right + carry
	flag(c, C, subtract ? result < 0 : result > 255)
	flag(c, V, !!((subtract ? left ^ right : ~(left ^ right)) & (left ^ result) & 128))
	if (!subtract) flag(c, H, (left & 15) + (right & 15) + carry > 15)
	return nz(c, result)
}
export function push(c: CpuContext, v: number, stack = SP, pre = false): void { if (pre) c.r[stack] = c.r[stack] - 1 & 65535; c.write(c.r[stack], v & 255); if (!pre) c.r[stack] = c.r[stack] - 1 & 65535 }
export function pop(c: CpuContext, stack = SP, pre = false): number { if (!pre) c.r[stack] = c.r[stack] + 1 & 65535; const value = c.read(c.r[stack]); if (pre) c.r[stack] = c.r[stack] + 1 & 65535; return value }
export function pushWord(c: CpuContext, v: number, stack = SP, pre = false): void { push(c, v, stack, pre); push(c, v >>> 8, stack, pre) }
export function popWord(c: CpuContext, stack = SP, pre = false): number { return pop(c, stack, pre) << 8 | pop(c, stack, pre) }
export function monitor(c: CpuContext): void {
	switch (c.r[A]) {
		case 0: c.halt(); break
		case 1: c.output(String(c.r[B] << 24 >> 24)); break
		case 2: c.output(String.fromCharCode(c.r[B])); break
		case 3: c.r[B] = c.inputInteger(8) & 255; break
		default: throw new Error(`Unknown THRAX SWI service ${c.r[A]}`)
	}
}
export function unaryValue(c: CpuContext, op: number, v: number): number {
	let result = v
	switch (op) {
		case 0: result = -v; flag(c, C, v !== 0); flag(c, V, v === 128); break
		case 3: result = ~v; flag(c, C, true); flag(c, V, false); break
		case 4: result = v >>> 1; flag(c, C, !!(v & 1)); break
		case 6: result = v >>> 1 | (c.r[CC] & C ? 128 : 0); flag(c, C, !!(v & 1)); break
		case 7: result = v >> 1 | v & 128; flag(c, C, !!(v & 1)); break
		case 8: result = v << 1; flag(c, C, !!(v & 128)); break
		case 9: result = v << 1 | (c.r[CC] & C); flag(c, C, !!(v & 128)); break
		case 10: result = v - 1; flag(c, V, v === 128); break
		case 12: result = v + 1; flag(c, V, v === 127); break
		case 13: flag(c, C, false); flag(c, V, false); break
		case 15: result = 0; flag(c, V, false); flag(c, C, false); break
	}
	result = nz(c, result)
	if ([4, 6, 7, 8, 9].includes(op)) flag(c, V, !!(c.r[CC] & N) !== !!(c.r[CC] & C))
	return result
}
