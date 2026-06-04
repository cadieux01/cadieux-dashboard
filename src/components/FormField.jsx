import { useState } from 'react'

// Eye / eye-off icons for the password show-hide toggle.
function EyeIcon({ off }) {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {off ? (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
      ) : (
        <>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </>
      )}
    </svg>
  )
}

export default function FormField({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  options,
  error,
  minLength,
}) {
  const [showPassword, setShowPassword] = useState(false)

  const labelEl = (
    <label className="mb-1 block text-xs font-semibold text-slate-300">
      {label}
      {required && <span className="ml-1 text-rose-400">*</span>}
    </label>
  )

  const errorEl = error ? (
    <p className="mt-1 text-xs text-rose-400">{error}</p>
  ) : null

  if (type === 'select') {
    return (
      <div className="mb-3">
        {labelEl}
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className={`dashboard-select ${error ? 'dashboard-input-error' : ''}`}
        >
          <option value="">Select {label}</option>
          {options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {errorEl}
      </div>
    )
  }

  if (type === 'textarea') {
    return (
      <div className="mb-3">
        {labelEl}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          rows={3}
          className={`dashboard-textarea ${error ? 'dashboard-input-error' : ''}`}
        />
        {errorEl}
      </div>
    )
  }

  // Password fields get a right-aligned show/hide eye toggle.
  if (type === 'password') {
    return (
      <div className="mb-3">
        {labelEl}
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            required={required}
            minLength={minLength ?? 6}
            className={`dashboard-input pr-12 ${error ? 'dashboard-input-error' : ''}`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            className={`absolute right-3 top-1/2 -translate-y-1/2 transition-colors ${
              showPassword ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
            }`}
            tabIndex={-1}
          >
            <EyeIcon off={!showPassword} />
          </button>
        </div>
        {errorEl}
      </div>
    )
  }

  return (
    <div className="mb-3">
      {labelEl}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        className={`dashboard-input ${error ? 'dashboard-input-error' : ''}`}
      />
      {errorEl}
    </div>
  )
}
