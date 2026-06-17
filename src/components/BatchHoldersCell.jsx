// Compact chips listing who currently holds unsold units from a batch.
// Agents (in-hand) are emerald; partners (downstream unsold) are sky.
export default function BatchHoldersCell({ holders }) {
  if (!holders || holders.length === 0) {
    return <span className="text-slate-600">—</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {holders.map((h, i) => (
        <span
          key={`${h.role}-${h.id}-${h.variant || ''}-${i}`}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            h.role === 'agent'
              ? 'border-emerald-700 bg-emerald-500/10 text-emerald-300'
              : 'border-sky-700 bg-sky-500/10 text-sky-300'
          }`}
        >
          <span className="truncate max-w-[8rem]">{h.name}</span>
          {h.variant_label && <span className="text-slate-400">· {h.variant_label}</span>}
          <span className="font-mono font-semibold">{h.units}</span>
        </span>
      ))}
    </div>
  )
}
