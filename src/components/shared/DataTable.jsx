import React from "react";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { TableSkeleton, ErrorCard } from "@/components/shared/Skeletons";
import EmptyState from "@/components/shared/EmptyState";
import ListPagination from "@/components/shared/ListPagination";

export default function DataTable({
  columns = [],
  data = [],
  loading = false,
  error = null,
  onRetry,
  emptyMessage = "No results found",
  emptyIcon,
  pagination,
  selectAllChecked,
  onSelectAll,
  selectedIds,
  onRowSelect,
  getRowId = (row) => row.id,
  bulkActions,
  actions,
  containerClassName,
  theadClassName,
  tbodyClassName,
}) {
  const hasSelection = typeof onRowSelect === "function";
  const hasActions = typeof actions === "function";

  if (loading) return <TableSkeleton rows={6} columns={columns.length} />;
  if (error) return <ErrorCard onRetry={onRetry} />;

  return (
    <>
      {bulkActions}
      <div className={cn("bg-white rounded-xl border border-stone-200 overflow-x-auto shadow-sm", containerClassName)}>
        <table className="w-full text-sm">
          <TableHeader className={cn("bg-stone-50 text-stone-600 text-xs font-semibold tracking-wider uppercase border-b border-stone-200 select-none", theadClassName)}>
            <TableRow className="border-none">
              {hasSelection && (
                <TableHead scope="col" className="px-4 py-3 w-10">
                  <Checkbox checked={selectAllChecked} onCheckedChange={onSelectAll} aria-label="Select all on page" />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead scope="col" key={col.key} className={cn("text-left px-4 py-3 font-semibold", col.headerClassName)}>
                  {col.header}
                </TableHead>
              ))}
              {hasActions && <TableHead scope="col" className="text-right px-4 py-3 font-semibold">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody className={cn(tbodyClassName)}>
            {data.length === 0 ? (
              <TableRow className="border-none">
                <TableCell colSpan={columns.length + (hasSelection ? 1 : 0) + (hasActions ? 1 : 0)}>
                  <EmptyState icon={emptyIcon} title={emptyMessage} />
                </TableCell>
              </TableRow>
            ) : (
              data.map((row) => {
                const id = getRowId(row);
                const isSelected = selectedIds?.includes(id);
                return (
                  <TableRow
                    key={id}
                    className={cn("border-t border-stone-100 transition-colors hover:bg-stone-50/70", isSelected && "bg-indigo-50/50")}
                  >
                    {hasSelection && (
                      <TableCell className="px-4 py-3">
                        <Checkbox checked={isSelected} onCheckedChange={() => onRowSelect(id)} aria-label={`Select row ${id}`} />
                      </TableCell>
                    )}
                    {columns.map((col) => (
                      <TableCell key={col.key} className={cn("px-4 py-3", col.className)}>
                        {col.cell ? col.cell(row) : row[col.key]}
                      </TableCell>
                    ))}
                    {hasActions && (
                      <TableCell className="px-4 py-3 text-right">
                        {actions(row)}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </table>
        {pagination && (
          <ListPagination
            page={pagination.page}
            totalItems={pagination.totalItems}
            pageSize={pagination.pageSize}
            onPageChange={pagination.onPageChange}
          />
        )}
      </div>
    </>
  );
}
