# Thrax

A MIPS assembly IDE: an assembler and machine simulator in TypeScript with a dockable
React UI for editing, running, debugging, and visualizing programs.

## Settings

**Setting**:
One IDE-level option, defaulting to what MARS defaults to. The model is pure: consumers
read `ThraxSettings` and apply the effect themselves, so nothing reads storage twice.

## Language

### Assembly

**Diagnostic**:
A positioned assembly error or warning (severity, message, file, line, column). The only
channel by which assembly failures reach the UI.
_Avoid_: console error string, exception message

**SourceIndex**:
The bidirectional line ↔ address ↔ word relation for an assembled program, built once by
the assembler's layout pass and carried on the program.
_Avoid_: sourceMap, sourceMaps, codeWords

**Pseudo-instruction**:
A source mnemonic the assembler expands into several machine words on one source line.

**Instruction table**:
The one description of every instruction the assembler and the decoder share: the bit
pattern each form matches, its operands, and how it is written. Adding an instruction
means adding one entry, and the decoder resolves a word by longest mask first.
_Avoid_: opcode map, instruction list (those are its derived readers)

**Translation unit**:
The file a symbol belongs to: one assembled in its own right. An `.include` is spliced
into its includer, so its labels are the includer's, and a token keeps its own file for
diagnostics while taking the includer's unit.
_Avoid_: compilation unit, module

**Symbol tables**:
Per-unit local tables plus one global table. `.globl` moves a name out of its file's
table into the one every file sees; a reference resolves locally first, then globally.
_Avoid_: labels (the flat `program.labels` is a display view, not what resolution uses)

### Machine

**Machine state**:
Registers, memory, PC, hi/lo, and run status, owned by the simulator and reached only
through its methods and getState(). Nothing outside the simulator writes it directly.

**Memory view**:
How panels read memory: the simulator's own word map, handed over rather than copied,
behind a wrapper whose identity changes on each publish. There is one memory and it is
written in place, so the wrapper is the only thing a selector can compare; copying it
cost as much per publish as running a whole program.
_Avoid_: memory snapshot, address-keyed record

**Memory configuration**:
The addresses every segment lays out from, one of three layouts. It is passed to the
assembler and the machine rather than read from anywhere global, so nothing can disagree
about where a segment is.
_Avoid_: segment constants, base addresses

**Effect**:
One thing an instruction changed, holding the value that is **not** in the machine.
Behind the present that is what the instruction destroyed; ahead of it, what it produced.
Applying an effect exchanges the two, so one operation undoes and redoes.
_Avoid_: undo record, delta, diff

**Effect store**:
The columns effects live in: a kind, two numbers, and for a few kinds one value that is
not a number. Held as an object each an effect costs about 56 bytes; in columns it costs
nine. The columns come in fixed-size blocks addressed by a packed index, so evicting is
dropping a block rather than copying, and one instruction's effects never span two of
them.
_Avoid_: effect array (an array per entry costs more in empty slots than the effects)

**History entry**:
One executed instruction, or one edit made by hand, and the range of effects it owns. The
log is bounded by the backstep limit, and an entry is addressed by a monotonic id rather
than an index, since the oldest are dropped. Entries roll in fixed-size blocks like their
effects do, so dropping the oldest is dropping a block off the front of a short list
rather than moving every entry behind them.
_Avoid_: snapshot (the machine is no longer copied per instruction)

**Cursor**:
How many entries stand behind the present. Stepping back moves it rather than dropping
entries, because the entries ahead hold what those instructions produced; running
forward applies them again instead of executing.
_Avoid_: redo stack, replay queue

**Device port**:
How a memory-mapped device answers the program: reads past the protections, writes
queued for the top of the next instruction so each lands as its own recorded event, and
interrupts offered to the machine, which refuses one it cannot take. The observer seam
stays read-only.

**Observer seam**:
The ExecutionObserver interface through which tools watch a run (instruction, memory,
branch, reset, seek, machine configuration). The zero-cost-when-empty attachment point.
_Avoid_: listener, hook, callback list

**Seek**:
Telling a tool the machine has moved to a given instruction count, in either direction.
A tool's numbers accumulate, so without it they climb across a step back; a tool answers
by clearing what it worked out and running the instructions through itself again, from
the machine's own log (`Replay`).  It keeps no copy of its state per step: what a replay
cannot recover, being what the machine decided rather than what it ran, it notes as it
watches (`StepLog`).
_Avoid_: checkpoint, snapshot (a tool takes neither)

**Service**:
Something the machine carries and does not understand: a tool's device, an open file,
a stream of numbers.  It says what a slot held as an instruction changes it (`keep`) and
puts one back when the machine hands it over again (`exchange`), so it rolls back with
everything else while the core stays ignorant of what any of it means.  For state that
is not a tally and so cannot be replayed out of the log.
_Avoid_: subsystem snapshot, checkpoint

**Tool**:
A simulation-analysis accumulator attached at the observer seam: pipeline, cache, branch
history, instruction statistics, execution profile.
_Avoid_: plugin, panel (a panel is the UI view of a tool)

**ToolRegistry**:
The one description of every tool: its settings (key, defaults, validator), reset,
attachment, and snapshot. Adding a tool means adding one entry.

### Workspace

**Project**:
The files the assembler can see: every document, whether or not it has a tab. Closing
a tab puts a file away (`hidden`) rather than out of the project; the file list is
where it is brought back or removed for good.
_Avoid_: open files (a file can be in the project with no tab)

**Workspace snapshot**:
The project as a document: the files, the one in front, and the multi-file setting.
The one shape that carries a workspace out of the session and back, by whatever road:
browser storage, autosave, a `.zip`, a share link, a gist, `?load=`. Ids are not in
it, since they are made up per session.
_Avoid_: saved program (the old browser-slot shape, still read)

**Folder project**:
A directory on disk made the project through the browser's folder picker, the way a
directory is MARS's project. Saving writes each file back where it came from. The
handle is remembered in IndexedDB and asked about again on the next visit.

### Debugging

**DebugSession**:
The module owning stepping policy and breakpoint bookkeeping, between the workspace and
the machine. The workspace never mutates machine state directly.

**Visible address**:
An address the debugger will stop at. Source-line addresses are always visible; a
pseudo-instruction's expanded words become visible only when disassembly rows are shown.

**Hidden word**:
An expanded word of a pseudo-instruction that is not currently visible; stepping passes
through it without stopping.

### X-ray

**X-ray**:
The animated CPU datapath diagram showing how the current instruction flows through
blocks and wires.

**Shape**:
The single outline definition of an x-ray block (ALU, gates, register file), from which
wire hit-testing, the on-screen SVG, and the export script all derive.
_Avoid_: outline copy, path string (those are its two derived readers)

## Workspace

**Panel catalogue**:
The one list of everything a panel can be: which are windows and which are tools, which
open by themselves, and where each docks. The menu, the default layout, and the lazy
loading all read it, so nothing can offer a panel the layout cannot place.

**Row window**:
The band of rows a long list actually draws, with overscan past each edge. Its size only
changes when the panel is resized, which is what lets rows be a pool that is rewritten
rather than mounted and unmounted per scroll.

**Fixed rows**:
Rows pinned by hand rather than laid out, against a frame measured from a probe. It buys
a scroll that moves three numbers per row, and costs the scroller having to become their
containing block and hand them the wheel.
_Avoid_: virtual list, windowing library

**Flash**:
A highlight that fades rather than latching, so nothing decides when to take it off.
Navigation says where a click sent you and lights one thing; change says what the last
step moved and can light several.
