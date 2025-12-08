import * as React from 'react'
import { cn } from '@/lib/utils'

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('surface', className)} {...props} />
})

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('flex flex-col gap-1.5 p-5 pb-3', className)} {...props} />
})

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(function CardTitle(
  { className, ...props },
  ref
) {
  return <h3 ref={ref} className={cn('font-semibold leading-6 tracking-tight', className)} {...props} />
})

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...props }, ref) {
    return <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  }
)

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardContent(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('p-5 pt-2', className)} {...props} />
})

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function CardFooter(
  { className, ...props },
  ref
) {
  return <div ref={ref} className={cn('flex items-center p-5 pt-0', className)} {...props} />
})

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle }
