import { useState } from 'react'

export default function DataTable({ columns, data, onSort, sortField, sortDirection, rowClassName }) {
  const handleSort = (field) => {
    if (onSort) {
      onSort(field)
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="dashboard-table w-full min-w-[720px]">
        <thead className="sticky top-0 z-10 backdrop-blur-xl">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`border-b border-white/8 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 ${
                  column.sortable ? 'cursor-pointer transition-colors hover:text-white' : ''
                }`}
                onClick={() => column.sortable && handleSort(column.key)}
              >
                <div className="flex items-center gap-2">
                  {column.label}
                  {column.sortable && sortField === column.key && (
                    <svg
                      className={`w-4 h-4 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                    </svg>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12 text-center text-slate-500">
                No data available
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <tr
                key={row.id || rowIndex}
                className={`border-b border-white/6 last:border-b-0 ${
                  rowClassName ? rowClassName(row) : ''
                }`}
              >
                {columns.map((column) => (
                  <td key={column.key} className="px-4 py-3.5 text-sm text-slate-300">
                    {column.render ? column.render(row[column.key], row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
