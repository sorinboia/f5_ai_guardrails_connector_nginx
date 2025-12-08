import { type ReactNode, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Card } from './card'
import { Button } from './button'

type ModalProps = {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, description, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8 sm:px-6">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden onClick={onClose} />
      <Card
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-10 w-full max-w-3xl border-border/60 bg-background shadow-2xl shadow-black/20',
          className,
        )}
      >
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div>
            {title ? <h2 className="text-lg font-semibold leading-tight">{title}</h2> : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </Card>
    </div>,
    document.body,
  )
}
