import { Button } from '@/components/ui/button'

export type PaginationProps = {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  const prevDisabled = page <= 1
  const nextDisabled = page >= totalPages

  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Page {page} of {totalPages || 1}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={prevDisabled} onClick={() => onPageChange(page - 1)}>
          Prev
        </Button>
        <Button variant="outline" size="sm" disabled={nextDisabled} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
