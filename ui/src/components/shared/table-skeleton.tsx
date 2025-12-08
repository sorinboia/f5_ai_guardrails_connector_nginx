import { Skeleton } from '@/components/ui/skeleton'

export type TableSkeletonProps = {
  columns: number
  rows?: number
}

export function TableSkeleton({ columns, rows = 4 }: TableSkeletonProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex flex-wrap gap-3 rounded-lg border px-3 py-2 text-sm">
          {Array.from({ length: columns }).map((__, colIdx) => (
            <Skeleton key={colIdx} className="h-4 flex-1 min-w-[120px]" />
          ))}
        </div>
      ))}
    </div>
  )
}
