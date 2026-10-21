/**
 * The file table behind syscalls 13-16.
 *
 * A browser tab has no filesystem to open, so files live in memory for the
 * lifetime of the run.  A program can write a file and read it back, which is
 * what the file exercises need; descriptors 0, 1, and 2 keep their usual
 * meanings and are wired to the console by the simulator.
 */

import type { FilesSnapshot } from './types'

export const STDOUT = 1
export const STDERR = 2

/** Open flags: read, write (truncating), and write (appending). */
export const O_RDONLY = 0
export const O_WRONLY = 1
export const O_APPEND = 9

const FIRST_DESCRIPTOR = 3

interface OpenFile {
	name: string
	writable: boolean
	position: number
}

export class FileTable {
	/** File contents by name, surviving close and reopen within one run. */
	private contents = new Map<string, number[]>()
	private open = new Map<number, OpenFile>()
	private nextDescriptor = FIRST_DESCRIPTOR

	/** Returns a descriptor, or -1 when the file cannot be opened as asked. */
	openFile(name: string, flags: number): number {
		const writable = flags === O_WRONLY || flags === O_APPEND
		if (!writable && flags !== O_RDONLY) return -1
		if (!writable && !this.contents.has(name)) return -1

		if (flags === O_WRONLY) this.contents.set(name, [])
		else if (!this.contents.has(name)) this.contents.set(name, [])

		const descriptor = this.nextDescriptor++
		const position = flags === O_APPEND ? this.contents.get(name)!.length : 0
		this.open.set(descriptor, { name, writable, position })
		return descriptor
	}

	/** Up to `count` bytes from the descriptor's position, or -1 if not readable. */
	read(descriptor: number, count: number): number[] | -1 {
		const file = this.open.get(descriptor)
		if (!file || file.writable) return -1
		const data = this.contents.get(file.name) ?? []
		const bytes = data.slice(file.position, file.position + Math.max(0, count))
		file.position += bytes.length
		return bytes
	}

	/** The number of bytes written, or -1 if the descriptor is not writable. */
	write(descriptor: number, bytes: number[]): number {
		const file = this.open.get(descriptor)
		if (!file || !file.writable) return -1
		const data = this.contents.get(file.name) ?? []
		for (let index = 0; index < bytes.length; index++) data[file.position + index] = bytes[index] & 0xff
		file.position += bytes.length
		this.contents.set(file.name, data)
		return bytes.length
	}

	close(descriptor: number): number {
		return this.open.delete(descriptor) ? 0 : -1
	}

	/** The bytes a file holds, for tests and for the workspace to export. */
	contentsOf(name: string): number[] | undefined {
		return this.contents.get(name)
	}

	names(): string[] {
		return [...this.contents.keys()]
	}

	/**
	 * The whole table, deeply copied, so a backstep can put it back (bug 14).
	 * Only the syscalls that touch a file ask for one, so the cost lands on the
	 * rare instruction rather than on every step.
	 */
	snapshot(): FilesSnapshot {
		return {
			contents: [...this.contents].map(([name, bytes]) => ({ name, bytes: [...bytes] })),
			open: [...this.open].map(([descriptor, file]) => ({ descriptor, ...file })),
			nextDescriptor: this.nextDescriptor,
		}
	}

	/** Puts back a `snapshot`, discarding everything the table holds now. */
	restore(snapshot: FilesSnapshot) {
		this.contents = new Map(snapshot.contents.map(({ name, bytes }) => [name, [...bytes]]))
		this.open = new Map(snapshot.open.map(({ descriptor, name, writable, position }) => [descriptor, { name, writable, position }]))
		this.nextDescriptor = snapshot.nextDescriptor
	}
}
