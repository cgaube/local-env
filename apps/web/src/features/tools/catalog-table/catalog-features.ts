import {
  columnFacetingFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  constructFilterFn,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_arrIncludesSome,
  filterFn_includesString,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_text,
  tableFeatures,
} from '@tanstack/react-table'

// Only what the catalog uses: the rest of TanStack Table isn't bundled
export const catalogFeatures = tableFeatures({
  columnFacetingFeature,
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSortingFeature,
  // The counts of the source and tag filters
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: {
    includesString: filterFn_includesString,
    // Has one of the picked tags
    arrIncludesSome: filterFn_arrIncludesSome,
    // The value is one of the picked ones: the source filter
    oneOf: constructFilterFn({
      filter: (value, picked: string[]) => picked.includes(value),
      autoRemove: (picked?: string[]) => !picked?.length,
    }),
  },
  sortFns: { text: sortFn_text },
})

export type CatalogFeatures = typeof catalogFeatures
