import type { ReactNode } from 'react'

export type PageHeaderProps = {
  title: string
  subtitle?: string
  description?: string
  action?: ReactNode
}

export function PageHeader({ title, subtitle, description, action }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        {subtitle ? <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{subtitle}</p> : null}
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold leading-7 text-foreground">{title}</h1>
        </div>
        {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </header>
  )
}
