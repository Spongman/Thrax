# THRAX: the work that is left

Everything that was outstanding has landed. The repository history is the record of it, and
`CONTEXT.md` names the concepts the work introduced.

## Ground rules for every work item

- **Verification is a failing test.** Each item lands with a test that fails on the parent
  commit and passes after. "Existing suite still green" is not verification.
- **Anything the browser decides is verified in a browser.** There is no DOM test
  environment, so a unit test can pin a class string or an arithmetic split and still say
  nothing about z-order, which element takes the pointer, whether a panel came forward, or
  where a fixed row landed. Every one of those has been wrong here while its unit tests
  passed. Drive the app: Playwright lives in the npx cache and the browsers under
  `ms-playwright`, and `npm run dev` serves `/Thrax/` on port 3000.
- **MARS is the spec, but it is not the audience.** Use MARS to decide what the behaviour
  should be, and say so in the work report. Do **not** litter the source with MARS
  citations: THRAX is its own program and reads as one. A reference earns its place only
  where the behaviour is otherwise inexplicable, or where someone would reasonably "fix" a
  rule if they did not know why it is there.
- **Keep the documents fresh as each item lands**, not in a pass at the end. `PLAN.md` for
  what is left, `CONTEXT.md` for a concept the work introduced, `README.md` for a claim it
  made false.
- Commands: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Build output
  goes to `./build.log`. `npm test` passing is not enough on its own: the typecheck catches
  what the test run does not, such as a lib-target gap.
- Comments stay short. No refactoring beyond what an item requires.

---

## Not doing

Decisions already taken, recorded so they are not re-raised as gaps.

- **No text-segment window.** The source gutter already shows address, machine code and
  disassembly per line, including the expanded words of a pseudo-instruction, and its
  disassembly answers hovers with the same data tip the source does.
- **MIDI stays silent.** Syscalls 31 and 33 keep their timing and emit no sound.
- **No screen magnifier.** Desktop capture has no browser equivalent, and a lens over the
  workspace is not worth a panel.
- **A diamond `.include`** assembles; only a genuine cycle is an error.
- **`swr $t1,100`** keeps its base register rather than reproducing the reference template's
  typo, which stores through `$zero` and discards the address it just computed.
- **Divide by zero raises nothing** and leaves HI/LO undefined.
- **The heap and the stack are one region** in every memory configuration, so the memory
  view's split between them is its own: the stack takes the top eighth of that span, which
  scales to the compact layouts where the whole span is 4 KB.

- **A tool watches a run only while something consumes it.** A tool panel asks for its own
  tool, and the heat-map toggle asks for the profile; nothing else runs. That is MARS's own
  "Connect to MIPS" bargain, and it is what makes a run cost 101ms instead of 2289ms with
  nothing open. It follows that a device tool cannot answer a program that never opened it:
  a Digital Lab timer interrupt does not fire with the tab closed, and its readings begin
  when the tab does.

## Out of scope

A headless CLI, batch simulation, memory dump formats, project-directory assembly,
source-file import and export, close-all/save-all, integrated help, configurable editor theme
and font, printing, and external tool loading.

## Known gaps

- The production bundle is 4.8 MB minified, 1.26 MB gzipped, plus a 7 MB TypeScript worker
  and several unused language chunks. The tool views are now chunks of their own, fetched
  when a tool is opened, but that is only 108 KB of it: the rest is Monaco.
- The history is bounded by the backstep limit, 100,000 instructions by default and
  1,000,000 at most, so stepping back past what it holds is not possible and neither is
  replaying what came before that point.
- The Digital Lab Simulator's memory-mapped region is fixed at 0xffff0000 rather than taken
  from the chosen memory configuration, so its bytes are at the wrong addresses under the
  two compact layouts.
- The source gutter draws one address as several injected runs so its leading zeros can dim,
  and their order rests on how Monaco breaks a tie: injections at one position come out of
  an in-order tree walk, and the sort that follows is stable. That holds in the version
  pinned here and is not a documented contract, so an upgrade could put the zeros after the
  digits. `gutterAddress.test.ts` pins the runs THRAX hands over, not the order Monaco draws
  them in.
- A gutter address on a source line has no tooltip, while the expanded words below it offer
  "Show 0x… in memory". Injected text carries no `title`, so the two cannot match without
  moving to a hover provider.
- Two mechanisms answer "written in place, so a selector would never see a change": the
  history log publishes by reference beside a `historyVersion` counter, and the memory view
  publishes a wrapper whose identity changes. The wrapper is the better of the two, since a
  new consumer cannot forget it, and the counter is what is left to converge.
- Opening the memory or registers window from the Window menu lights whatever the last
  navigation asked for. A navigation flash starts from nothing so that a panel opened *by* a
  navigation lights its destination, and a panel opened by hand cannot be told apart from
  one opened that way. It already scrolled there before it also lit there.
- With a caret set, the memory window keeps the tab key: tab swaps the hex and ASCII
  columns rather than leaving the panel, and Escape is what gives it back. That is what
  a hex editor does with the key, and it is still a keyboard trap for anyone who does
  not know the way out.
- Insert and delete walk the whole word map to find the last written byte in the region,
  once per keystroke. It is what keeps a shift over a region gigabytes wide from being a
  loop over all of it, and it costs a pass over every word the program has ever touched.

- Nothing **in the tree** drives a browser. A browser is driven by hand when a change needs
  it, per the ground rule above, but no harness is committed and nothing runs on its own, so
  everything the layout decides is a manual check that will not be repeated unless someone
  repeats it. The gutter data tip is the current instance: what it says, where in the token
  it is anchored and how its Markdown is drawn are covered, but that the pointer reaches an
  injected-text span at all, and that the widget lands inside the editor wearing the
  editor's own hover chrome, are not.
