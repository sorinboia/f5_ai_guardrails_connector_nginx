import * as React from 'react'
import { cn } from '@/lib/utils'

type TableProps = React.TableHTMLAttributes<HTMLTableElement>

export function Table({ className, ...props }: TableProps) {
  return <table className={cn('w-full text-left text-sm', className)} {...props} />
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground" {...props} />
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="divide-y divide-border" {...props} />
}

export function TR(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className="hover:bg-muted/60" {...props} />
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('px-3 py-2 font-semibold text-foreground', className)} {...props} />
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2 align-top text-foreground', className)} {...props} />
}
