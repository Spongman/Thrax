/** Byte lanes are the dependency resources: BC/DE/HL/AF and index halves alias
 * their constituent bytes. F is one resource, so partial flag writes also read F.
 * Sequential PC/refresh increments are not data hazards. */
export const DEPENDENCY_NAMES = ['B', 'C', 'D', 'E', 'H', 'L', 'F', 'A', 'IXH', 'IXL', 'IYH', 'IYL', 'SP', 'I', 'R', 'IFF1', 'IFF2', 'IM', 'B2', 'C2', 'D2', 'E2', 'H2', 'L2', 'F2', 'A2']

export function registerTraffic(op: number, page: number, index: 'IX' | 'IY' | '') {
	let memoryRead = false
	const reads = new Set<number>(), writes = new Set<number>(), loaded = new Set<number>()
	const read = (...registers: number[]) => { for (const r of registers) reads.add(r) }
	const write = (...registers: number[]) => { for (const r of registers) writes.add(r) }
	const load = (...registers: number[]) => { write(...registers); for (const r of registers) loaded.add(r) }
	const flags = () => { read(6); write(6) }
	const hl = index === 'IX' ? [8, 9] : index === 'IY' ? [10, 11] : [4, 5]
	const pair = (p: number, af = false, plain = false) => p === 0 ? [0, 1] : p === 1 ? [2, 3] : p === 2 ? plain ? [4, 5] : hl : af ? [7, 6] : [12]
	const reg = (r: number, plain = false) => r === 4 && !plain ? hl[0] : r === 5 && !plain ? hl[1] : r
	const readOperand = (r: number, plain = false) => r === 6 ? (memoryRead = true, read(...hl)) : read(reg(r, plain))
	const writeOperand = (r: number, fromMemory = false, plain = false) => {
		if (r === 6) read(...hl)
		else if (fromMemory) load(reg(r, plain))
		else write(reg(r, plain))
	}
	const stack = () => { read(12); write(12) }
	const exchange = (...registers: number[]) => { read(...registers); write(...registers) }
	const alu = (y: number) => { read(7); if (y === 1 || y === 3) read(6); write(6); if (y !== 7) write(7) }
	const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1
	if (page === 1 || page === 4) {
		if (page === 4) { memoryRead = true; read(...hl) }
		else readOperand(z)
		if (x === 0 || x === 1) flags()
		if (x !== 1) {
			if (page === 4) { if (z !== 6) load(z) }
			else writeOperand(z)
		}
	} else if (page === 2) {
		// DD/FD prefixes before ED are ignored.
		if (x === 1) switch (z) {
			case 0: read(0, 1); if (y !== 6) load(y); flags(); break
			case 1: read(0, 1); if (y !== 6) read(y); break
			case 2: read(4, 5, ...pair(p, false, true)); flags(); write(4, 5); break
			case 3: if (q) load(...pair(p, false, true)); else read(...pair(p, false, true)); break
			case 4: read(7); write(7, 6); break
			case 5: stack(); read(16); write(15); break
			case 6: write(17); break
			case 7:
				if (y < 2) { read(7); write(y === 0 ? 13 : 14) }
				else if (y < 4) { read(y === 2 ? 13 : 14, 16); write(7); flags() }
				else if (y < 6) { memoryRead = true; read(4, 5, 7); load(7); flags() }
				break
		} else if (x === 2 && y >= 4 && z <= 3) {
			memoryRead = true
			read(0, 1, 4, 5); write(0, 4, 5); flags()
			if (z <= 1) { read(7); write(1) }
			if (z === 0) { read(2, 3); write(2, 3) }
		}
	} else if (x === 0) switch (z) {
		case 0:
			if (y === 1) exchange(7, 6, 25, 24)
			else if (y === 2) { read(0); write(0) }
			else if (y >= 4) read(6)
			break
		case 1:
			if (!q) write(...pair(p))
			else { read(...hl, ...pair(p)); write(...hl); flags() }
			break
		case 2:
			if (p < 2) read(...pair(p))
			if (!q) read(...(p === 2 ? hl : [7]))
			else { memoryRead = true; load(...(p === 2 ? hl : [7])) }
			break
		case 3: exchange(...pair(p)); break
		case 4: case 5: readOperand(y); writeOperand(y); flags(); break
		case 6: writeOperand(y); break
		case 7: read(7); if (y < 6) write(7); flags(); break
	} else if (x === 1) {
		if (op !== 0x76) { readOperand(z, y === 6); writeOperand(y, z === 6, z === 6) }
	} else if (x === 2) { readOperand(z); alu(y) }
	else switch (z) {
		case 0: read(6); stack(); break
		case 1:
			if (!q) { stack(); load(...pair(p, true)) }
			else if (p === 0) stack()
			else if (p === 1) exchange(0, 1, 2, 3, 4, 5, 18, 19, 20, 21, 22, 23)
			else { read(...hl); if (p === 3) write(12) }
			break
		case 2: read(6); break
		case 3:
			if (y === 2 || y === 3) { read(7); if (y === 3) load(7) }
			else if (y === 4) { read(12, ...hl); load(...hl) }
			else if (y === 5) exchange(2, 3, 4, 5)
			else if (y >= 6) write(15, 16)
			break
		case 4: read(6); stack(); break
		case 5: if (!q) { read(...pair(p, true)); stack() } else if (p === 0) stack(); break
		case 6: alu(y); break
		case 7: stack(); break
	}
	if (writes.has(6) && (memoryRead || loaded.size > 0)) loaded.add(6)
	return { reads: [...reads], writes: [...writes], loadWrites: [...loaded], isLoad: memoryRead || loaded.size > 0 }
}
