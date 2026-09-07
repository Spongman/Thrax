import './TabStrip.css'

export interface Tab<Id extends string> {
	id: Id
	label: string
}

interface TabStripProps<Id extends string> {
	tabs: ReadonlyArray<Tab<Id>>
	active: Id
	onSelect: (id: Id) => void
}

/**
 * The workspace's one row of tabs: equal widths, the current one accented.
 *
 * The register panel picks its processor with these, and the pipeline panel its
 * view, so a panel with more than one face reads the same wherever it is.
 */
export default function TabStrip<Id extends string>({ tabs, active, onSelect }: TabStripProps<Id>) {
	return (
		<div className="tab-strip" role="tablist">
			{tabs.map((tab) => (
				<button
					key={tab.id}
					role="tab"
					aria-selected={tab.id === active}
					className={`tab${tab.id === active ? ' active' : ''}`}
					onClick={() => onSelect(tab.id)}
				>
					{tab.label}
				</button>
			))}
		</div>
	)
}
