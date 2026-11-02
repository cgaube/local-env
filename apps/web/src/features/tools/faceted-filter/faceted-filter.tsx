import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { Badge } from '#ui/components/ui/badge'
import { Button } from '#ui/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '#ui/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#ui/components/ui/popover'

// Picks values of a column, each with the number of rows that have it among
// those the other filters keep. None picked: every row.
export function FacetedFilter({
  title,
  options,
  picked,
  onChange,
}: {
  title: string
  // label: shown in place of the value
  options: { value: string; label?: string; count: number }[]
  picked: string[]
  onChange: (picked: string[]) => void
}) {
  const toggle = (value: string) =>
    onChange(
      picked.includes(value)
        ? picked.filter((other) => other !== value)
        : [...picked, value],
    )

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" />}>
        {title}
        {picked.length > 0 ? (
          <Badge variant="secondary">{picked.length}</Badge>
        ) : null}
        <ChevronDownIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No {title.toLowerCase()} found.</CommandEmpty>
            <CommandGroup>
              {options.map(({ value, label = value, count }) => (
                <CommandItem
                  key={value}
                  // Searched by what it shows
                  value={label}
                  // A checkbox at the start shows the pick, as in shadcn's
                  // faceted filter: CommandItem's own check mark, at the end,
                  // would keep the count off the edge
                  className="[&>svg:last-child]:hidden"
                  onSelect={() => toggle(value)}
                >
                  <span
                    aria-hidden="true"
                    data-picked={picked.includes(value)}
                    className="border-input data-[picked=true]:border-primary data-[picked=true]:bg-primary data-[picked=true]:text-primary-foreground flex size-4 items-center justify-center rounded-[4px] border"
                  >
                    {picked.includes(value) ? (
                      <CheckIcon className="size-3" />
                    ) : null}
                  </span>
                  <span className="flex-1 truncate">{label}</span>
                  <span className="text-muted-foreground font-mono text-xs tabular-nums">
                    {count}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {picked.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => onChange([])}
                    className="justify-center"
                  >
                    Clear
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
