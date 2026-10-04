import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const clampPage = (page, totalItems, pageSize) =>
  Math.min(page, Math.max(1, Math.ceil(totalItems / pageSize)));

export const pageSlice = (items, page, pageSize) =>
  items.slice((page - 1) * pageSize, page * pageSize);

export default function ListPagination({ page, totalItems, pageSize, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-stone-100 bg-white text-sm rounded-b-xl">
      <span className="text-stone-500">Showing {start}–{end} of {totalItems}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-stone-600">Page {page} of {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}