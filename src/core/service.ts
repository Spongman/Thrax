/**
 * State the machine carries but does not understand.
 *
 * Registers and memory roll back because the machine knows their shape: an
 * instruction writes one down, the log keeps what was there, and going back
 * exchanges the two.  A robot's position, a file's contents, a lab's switches
 * are the same kind of thing to the run and nothing like it to the code: they
 * belong to whatever holds them, and the machine has no business knowing a
 * heading from a descriptor.
 *
 * So a service says, as an instruction changes it, what it would take to put it
 * back.  The machine files that with everything else the instruction did and
 * hands it over again when the run moves across that instruction, in either
 * direction.  Everything the change costs to keep is the machine's side of it:
 * where the record lives, which instruction owns it, dropping it when the run
 * diverges or the history rolls past it.  The service's side is one call as it
 * changes and one call to put a change back.
 *
 * What it costs to keep is what any other effect costs: one row of the columns,
 * nine bytes, with nothing allocated unless the service asks to keep something
 * that is not a number.
 */

/** What a service's slot held, in the shape the service reads it back in. */
export interface ServiceState {
	value: number
	/** Anything the slot cannot say as a number; left off where it can. */
	payload?: unknown
}

export interface MachineService {
	/** What the history panel calls a change to it: "Mars Bot", "files". */
	readonly name: string
	/**
	 * Puts `slot` back to `value` and `payload`, and hands back what was there
	 * in the same shape.  Doing it twice leaves the service where it started,
	 * which is what lets one record serve going back and going forward.
	 */
	exchange(slot: number, value: number, payload: unknown): ServiceState
}

export interface ServiceRecorder {
	/**
	 * Keeps what `slot` holds now, before the instruction in hand changes it.
	 * A record made while nothing is being executed is dropped, since there is
	 * no instruction for it to belong to.
	 */
	keep(slot: number, value: number, payload?: unknown): void
}

/** Where a service signs up to be rolled back with the machine. */
export interface ServiceHost {
	register(service: MachineService): ServiceRecorder
}

/**
 * A record names a service and one of its slots, and the columns hold two
 * numbers, so the two share the first: the service in the top byte and the slot
 * in the rest.  That leaves a service sixteen million slots, which is more than
 * one needs to name what it holds, and keeps a record to a row of the columns.
 */
export const SERVICE_SHIFT = 24
export const SLOT_MASK = 0x00ffffff

export const packService = (service: number, slot: number) => ((service << SERVICE_SHIFT) | (slot & SLOT_MASK)) | 0
export const serviceOf = (packed: number) => (packed >>> SERVICE_SHIFT) & 0xff
export const slotOf = (packed: number) => packed & SLOT_MASK
