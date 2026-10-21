/**
 * What an effect changed, as the code the store's `kind` column holds.
 *
 * The column is a `Uint8Array`, so a kind is a number wherever it is stored and
 * a number wherever it is dispatched on: nothing turns it into a string except
 * a panel that has to print one.  A switch over strings compares characters,
 * since the name handed back is not the same object as the literal in a `case`.
 *
 * These live apart from the store so the `Effect` union can be discriminated by
 * them without the two files importing each other.
 */

/**
 * What each code means, in code order.
 *
 * Nothing reads these at run time: the store holds codes, the simulator
 * dispatches on codes, and the history panel writes its own wording.  They are
 * here to say what a code is, and for the test that pins each name to its
 * number.
 */
export const EFFECT_KINDS = [
	'register', 'fp', 'flag', 'cp0', 'memory', 'console', 'consoleReset',
	'display', 'queuedInput', 'call', 'hiLo', 'heapPointer', 'halted',
	'exitCode', 'sleep', 'input', 'service',
] as const

/**
 * The same kinds as the codes the `kind` column actually holds.
 *
 * The column is a `Uint8Array`, so a kind is already a number by the time
 * anything reads it: `kindAt` hands that number over, and only a panel with
 * something to print turns it back into a name.  A switch over strings
 * compares characters, since the name handed back is not the same object as the
 * literal in a `case`.
 *
 * The order is `EFFECT_KINDS`, which `kindsLineUp` in the tests pins.
 */
export class Kind {
	static readonly REGISTER = 0
	static readonly FP = 1
	static readonly FLAG = 2
	static readonly CP0 = 3
	static readonly MEMORY = 4
	static readonly CONSOLE = 5
	static readonly CONSOLE_RESET = 6
	static readonly DISPLAY = 7
	static readonly QUEUED_INPUT = 8
	static readonly CALL = 9
	static readonly HI_LO = 10
	static readonly HEAP_POINTER = 11
	static readonly HALTED = 12
	static readonly EXIT_CODE = 13
	static readonly SLEEP = 14
	static readonly INPUT = 15
	/**
	 * A change to something the machine holds but does not understand: a tool's
	 * device, an open file, a stream of numbers.  The service says what it would
	 * take to put itself back and the machine keeps it with everything else the
	 * instruction did.
	 */
	static readonly SERVICE = 16
}

/** The kinds this file dispatches on, bound so each case is a plain read. */
/**
 * The codes as bindings of a module, which is how they are meant to be read.
 *
 * `case Kind.REGISTER:` is a property of a class, and a switch of those is a
 * run of hash lookups.  Bound once here and imported, each case is a plain read
 * and the switch runs as fast as if the numbers were written into it.
 */
export const KIND_REGISTER = Kind.REGISTER
export const KIND_FP = Kind.FP
export const KIND_FLAG = Kind.FLAG
export const KIND_CP0 = Kind.CP0
export const KIND_MEMORY = Kind.MEMORY
export const KIND_CONSOLE = Kind.CONSOLE
export const KIND_CONSOLE_RESET = Kind.CONSOLE_RESET
export const KIND_DISPLAY = Kind.DISPLAY
export const KIND_QUEUED_INPUT = Kind.QUEUED_INPUT
export const KIND_CALL = Kind.CALL
export const KIND_HI_LO = Kind.HI_LO
export const KIND_HEAP_POINTER = Kind.HEAP_POINTER
export const KIND_HALTED = Kind.HALTED
export const KIND_EXIT_CODE = Kind.EXIT_CODE
export const KIND_SLEEP = Kind.SLEEP
export const KIND_INPUT = Kind.INPUT
export const KIND_SERVICE = Kind.SERVICE
