import React from 'react'
export function Button({ className = '', variant = 'default', size = 'default', ...props }) {
  const base = 'inline-flex items-center justify-center rounded-xl font-medium transition disabled:opacity-40 disabled:pointer-events-none'
  const variants = { default: 'bg-slate-900 text-white hover:bg-slate-700', outline: 'bg-white text-slate-700 border border-slate-200 shadow-sm hover:bg-slate-100' }
  const sizes = { default: 'px-3 py-2 text-sm', sm: 'px-2.5 py-1.5 text-sm' }
  return <button className={`${base} ${variants[variant] || variants.default} ${sizes[size] || sizes.default} ${className}`} {...props} />
}
