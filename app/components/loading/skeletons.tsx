// Decorative placeholders shaped like the dashboard views while their data
// loads. They are hidden from assistive technology (the winged piggybank next
// to them announces the loading state) and only pulse when motion is allowed.

const surface = "rounded-xl border border-(--deco-border) bg-(--deco-surface)";

function Bone({ className }: { className: string }) {
  return (
    <div
      className={`rounded-md bg-(--deco-surface-raised) motion-safe:animate-pulse ${className}`}
    />
  );
}

function HeadingSkeleton() {
  return (
    <div className="space-y-3">
      <Bone className="h-3 w-28" />
      <Bone className="h-8 w-44 max-w-full" />
      <Bone className="h-4 w-full max-w-md" />
    </div>
  );
}

function FieldSkeleton() {
  return (
    <div className="min-w-0 space-y-2">
      <Bone className="h-3 w-24 max-w-full" />
      <Bone className="h-10 w-full" />
    </div>
  );
}

function rows(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

export function ListingSkeleton({
  creationFields,
  filters,
  columns,
  rowCount = 6,
}: {
  // Fields of the creation form shown above the listing, if the view has one.
  creationFields?: number;
  filters: number;
  columns: number;
  rowCount?: number;
}) {
  const columnTemplate = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  return (
    <div aria-hidden="true" className="min-w-0 space-y-6" data-skeleton="listing">
      {creationFields ? (
        <div className={`${surface} space-y-4 p-4`} data-skeleton-part="creation-form">
          <Bone className="h-6 w-40 max-w-full" />
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows(creationFields).map((field) => (
              <FieldSkeleton key={field} />
            ))}
          </div>
          <Bone className="h-10 w-36 max-w-full" />
        </div>
      ) : null}
      <HeadingSkeleton />
      <div
        className={`${surface} grid min-w-0 grid-cols-1 items-end gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4`}
        data-skeleton-part="filters"
      >
        {rows(filters).map((filter) => (
          <FieldSkeleton key={filter} />
        ))}
        <Bone className="h-10 w-24" />
      </div>
      <div className={`${surface} min-w-0 overflow-hidden`} data-skeleton-part="table">
        <div className="grid gap-4 border-b border-(--deco-border) px-4 py-3" style={columnTemplate}>
          {rows(columns).map((column) => (
            <Bone className="h-3 w-3/4" key={column} />
          ))}
        </div>
        {rows(rowCount).map((row) => (
          <div
            className="grid gap-4 border-b border-(--deco-border) px-4 py-4 last:border-b-0"
            data-skeleton-part="row"
            key={row}
            style={columnTemplate}
          >
            {rows(columns).map((column) => (
              <Bone className="h-4 w-full" key={column} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Bone className="h-4 w-40 max-w-full" />
        <div className="flex gap-2">
          <Bone className="h-10 w-24" />
          <Bone className="h-10 w-24" />
        </div>
      </div>
    </div>
  );
}

export function SummarySkeleton() {
  return (
    <div aria-hidden="true" className="min-w-0 space-y-6" data-skeleton="summary">
      <HeadingSkeleton />
      <div
        className={`${surface} flex flex-col gap-4 p-4 sm:flex-row sm:items-end`}
        data-skeleton-part="period"
      >
        <div className="min-w-0 space-y-2 sm:w-48">
          <Bone className="h-3 w-24" />
          <Bone className="h-10 w-full" />
        </div>
        <div className="min-w-0 space-y-2 sm:w-48">
          <Bone className="h-3 w-32" />
          <Bone className="h-10 w-full" />
        </div>
        <Bone className="h-10 w-36" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-skeleton-part="metrics">
        {rows(4).map((metric) => (
          <div className={`${surface} space-y-3 p-5`} data-skeleton-part="metric" key={metric}>
            <Bone className="h-4 w-28 max-w-full" />
            <Bone className="h-8 w-36 max-w-full" />
            <Bone className="h-3 w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-2" data-skeleton-part="charts">
        {rows(2).map((chart) => (
          <div className={`${surface} min-w-0 space-y-3 p-4`} data-skeleton-part="chart" key={chart}>
            <Bone className="h-4 w-40 max-w-full" />
            <Bone className="h-48 w-full" />
          </div>
        ))}
      </div>
      <div className={`${surface} min-w-0 overflow-hidden`} data-skeleton-part="table">
        {rows(5).map((row) => (
          <div
            className="grid grid-cols-3 gap-4 border-b border-(--deco-border) px-4 py-3 last:border-b-0"
            key={row}
          >
            <Bone className="h-4 w-full" />
            <Bone className="h-4 w-full" />
            <Bone className="h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
