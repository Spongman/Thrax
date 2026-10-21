import type { Example, PanelContribution } from '../architectures/contracts'
import { exampleName, exampleOrder } from '../core/exampleCatalog'
import { menuLabel, panelById } from './panels'
import {
	BitmapIcon,
	BitwiseIcon,
	CodeBytesIcon,
	CoprocessorIcon,
	ExamplesIcon,
	FactorialIcon,
	FibonacciIcon,
	HelloIcon,
	InputIcon,
	KeyboardIcon,
	LoopIcon,
	MacrosIcon,
	MandelbrotIcon,
	RecursionIcon,
	SumIcon,
	type Icon
} from './icons'

/** The view owns every glyph; CPU modules supply program data, never rendering code. */
const icons = new Map<string, Icon>(Object.entries({
	hello: HelloIcon,
	input: InputIcon,
	sum: SumIcon,
	factorial: FactorialIcon,
	fibonacci: FibonacciIcon,
	ackermann: RecursionIcon,
	loop: LoopIcon,
	bitwise: BitwiseIcon,
	bitmap: BitmapIcon,
	macros: MacrosIcon,
	mmio: KeyboardIcon,
	keyboard: KeyboardIcon,
	interrupts: KeyboardIcon,
	mandelbrot: MandelbrotIcon,
	coprocessors: CoprocessorIcon,
	stack: RecursionIcon,
	call: RecursionIcon,
	memory: ExamplesIcon,
	compressed: CodeBytesIcon,
	cmos: BitwiseIcon
}))

/** Alternate syntax examples keep their own titles but share their semantic glyph. */
export const exampleIcon = (id: string): Icon => icons.get(id) ?? icons.get(id.replace(/Armasm$/, '')) ?? ExamplesIcon

export function exampleItems(examples: Readonly<Record<string, Example>>) {
	return Object.entries(examples)
		.map(([id, example]) => ({
			id,
			...example,
			name: exampleName(id, example.name),
			icon: exampleIcon(id)
		}))
		.sort((left, right) => exampleOrder(left.id) - exampleOrder(right.id) || left.name.localeCompare(right.name))
}

export default function ExamplesMenu({
	examples,
	onLoad,
	panels,
}: {
	examples: Readonly<Record<string, Example>>
	onLoad: (example: Example) => void
	panels?: readonly PanelContribution[]
}) {
	return exampleItems(examples).map((example) => (
		<button
			key={example.id}
			className="menu-item menu-item-described"
			role="menuitem"
			onClick={() => onLoad(example)}
		>
			<example.icon />
			<span className="item-name">{example.name}</span>
			<span className="item-desc">
				{example.description}
				{example.tools?.length ? <span className="example-tools">Opens: {example.tools.map((id) => {
					const panel = panelById(id, panels)
					return panel ? menuLabel(panel) : id
				}).join(', ')}</span> : null}
			</span>
		</button>
	))
}
