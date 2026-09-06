import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

type PaginationProps = {
  page: number;
  totalPages: number;
  limit: number;
  canChangeLimit?: boolean;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
};

const LIMIT_OPTIONS = [5, 10, 20, 50, 100];

/**
 * Page numbers around the current one, with ellipses standing in for the rest.
 *
 * Rendering every page was fine on a wide screen and unusable on a phone: 20
 * pages meant 20 buttons that pushed the next/last controls off the row.
 */
function pageWindow(page: number, totalPages: number, span: number): (number | "gap")[] {
  if (totalPages <= span) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const out: (number | "gap")[] = [];
  // Reserve slots for the first page, the last page and up to two ellipses.
  const inner = Math.max(1, span - 4);
  let start = Math.max(2, page - Math.floor(inner / 2));
  const end = Math.min(totalPages - 1, start + inner - 1);
  start = Math.max(2, end - inner + 1);

  out.push(1);
  if (start > 2) out.push("gap");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < totalPages - 1) out.push("gap");
  out.push(totalPages);

  return out;
}

export default function Pagination({
  page,
  totalPages,
  limit,
  canChangeLimit = true,
  onPageChange,
  onLimitChange,
}: PaginationProps) {
  if (totalPages <= 0) return null;

  // Phones fit far fewer buttons, so the window is rendered at two widths and
  // the wrong one is hidden. Doing it with CSS keeps it free of resize state.
  const compact = pageWindow(page, totalPages, 5);
  const wide = pageWindow(page, totalPages, 9);

  const numbers = (items: (number | "gap")[]) =>
    items.map((p, i) =>
      p === "gap" ? (
        <span
          key={`gap-${i}`}
          className="px-1 text-muted-foreground select-none"
          aria-hidden="true"
        >
          …
        </span>
      ) : (
        <Button
          key={p}
          size="sm"
          variant={p === page ? "default" : "outline"}
          onClick={() => onPageChange(p)}
          className="w-9 h-9 shrink-0"
          aria-label={`Page ${p}`}
          aria-current={p === page ? "page" : undefined}
        >
          {p}
        </Button>
      ),
    );

  return (
    <div className="flex flex-col items-stretch gap-3 mt-6 px-4 pb-4 sm:flex-row sm:items-center sm:justify-between sm:flex-wrap sm:px-0 sm:pb-0">
      {/* Rows per page */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Rows per page</span>
        <select
          value={limit}
          disabled={!canChangeLimit}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          className="border rounded-md px-2 py-1 bg-background disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {LIMIT_OPTIONS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-1.5 sm:gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 1}
          onClick={() => onPageChange(1)}
          aria-label="First page"
          className="hidden sm:inline-flex shrink-0"
        >
          <ChevronsLeft className="w-4 h-4" />
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
          className="shrink-0"
        >
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <div className="flex items-center gap-1.5 sm:hidden">{numbers(compact)}</div>
        <div className="hidden sm:flex items-center gap-2">{numbers(wide)}</div>

        <Button
          variant="outline"
          size="sm"
          disabled={page === totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
          className="shrink-0"
        >
          <ChevronRight className="w-4 h-4" />
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={page === totalPages}
          onClick={() => onPageChange(totalPages)}
          aria-label="Last page"
          className="hidden sm:inline-flex shrink-0"
        >
          <ChevronsRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
