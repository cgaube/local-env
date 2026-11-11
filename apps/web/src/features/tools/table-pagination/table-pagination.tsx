import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from 'lucide-react'
import { Button } from '#ui/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#ui/components/ui/select'

const PAGE_SIZES = [10, 25, 50, 100]

// Under a table, or a grid of cards: the page size and the pages, first to
// last
export function TablePagination({
  page,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sizeLabel = 'Rows per page',
}: {
  // From 0
  page: number
  pageCount: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  sizeLabel?: string
}) {
  const last = Math.max(pageCount - 1, 0)
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground" id="rows-per-page">
          {sizeLabel}
        </span>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => onPageSizeChange(Number(value))}
        >
          <SelectTrigger size="sm" aria-labelledby="rows-per-page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <span className="text-muted-foreground">
        Page {page + 1} of {last + 1}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="First page"
          disabled={page === 0}
          onClick={() => onPageChange(0)}
        >
          <ChevronsLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page === 0}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next page"
          disabled={page >= last}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRightIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Last page"
          disabled={page >= last}
          onClick={() => onPageChange(last)}
        >
          <ChevronsRightIcon />
        </Button>
      </div>
    </div>
  )
}
