import * as React from 'react'
import { cn } from '@/lib/utils'

export type SwitchProps = React.InputHTMLAttributes<HTMLInputElement>

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(({ className, ...props }, ref) => {
  return (
    <label className={cn('relative inline-flex cursor-pointer items-center', className)}>
      <input
        type="checkbox"
        className="peer sr-only"
        ref={ref}
        {...props}
      />
      <span className="h-5 w-9 rounded-full bg-muted transition peer-checked:bg-accent"></span>
      <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
    </label>
  )
})
Switch.displayName = 'Switch'
