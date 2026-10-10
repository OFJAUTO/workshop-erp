/**
 * Technicians as one-tap chips (hidden checkboxes), the same look on the assignment screen, the
 * job card and the planning card. Works in a plain form: every ticked chip posts name=technician.
 */
export function TechnicianChecks({ technicians, name = "technician", checked = [], hint }: { technicians: { id: string; display_name: string; note?: string | null }[]; name?: string; checked?: string[]; hint?: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {technicians.map((t) => (
          <label key={t.id} className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-white px-3 text-sm font-semibold cursor-pointer has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white">
            <input type="checkbox" name={name} value={t.id} defaultChecked={checked.includes(t.id)} className="sr-only" />
            {t.display_name}
            {t.note ? <span className="text-xs font-medium opacity-70">{t.note}</span> : null}
          </label>
        ))}
        {technicians.length === 0 ? <span className="text-sm text-muted">No technicians in this department yet. Set departments on the Team page.</span> : null}
      </div>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}
