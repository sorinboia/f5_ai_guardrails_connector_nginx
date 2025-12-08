import type { ReactNode } from 'react'
import { CircleDashed } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export type EmptyStateProps = {
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  icon?: ReactNode
  secondaryAction?: ReactNode
}

export function EmptyState({ title, description, actionLabel, onAction, icon, secondaryAction }: EmptyStateProps) {
  return (
    <Card className="border-dashed">
      <CardHeader className="items-start gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-accent">
          {icon || <CircleDashed className="h-5 w-5" />}
        </div>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription className="leading-relaxed">{description}</CardDescription> : null}
      </CardHeader>
      {(actionLabel || secondaryAction) && (
        <CardContent className="flex flex-wrap gap-2">
          {actionLabel ? (
            <Button onClick={onAction} variant="default">
              {actionLabel}
            </Button>
          ) : null}
          {secondaryAction}
        </CardContent>
      )}
    </Card>
  )
}
