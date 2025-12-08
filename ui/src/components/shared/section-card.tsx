import type { ReactNode } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export type SectionCardProps = {
  title: string
  description?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
}

export function SectionCard({ title, description, children, actions, className }: SectionCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
