export default function FormField({ label, type = 'text', value, onChange, placeholder, required = false, options }) {
  if (type === 'select') {
    return (
      <div className="mb-4">
        <label className="mb-2 block text-sm font-semibold text-slate-300">{label}</label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="dashboard-select"
        >
          <option value="">Select {label}</option>
          {options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (type === 'textarea') {
    return (
      <div className="mb-4">
        <label className="mb-2 block text-sm font-semibold text-slate-300">{label}</label>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          rows={3}
          className="dashboard-textarea"
        />
      </div>
    )
  }

  return (
    <div className="mb-4">
      <label className="mb-2 block text-sm font-semibold text-slate-300">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={type === 'password' ? 6 : undefined}
        className="dashboard-input"
      />
    </div>
  )
}





