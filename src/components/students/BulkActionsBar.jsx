import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CheckCircle2, Archive, Trash2, X } from "lucide-react";

export default function BulkActionsBar({ count, onSetStatus, onDelete, onClear, busy }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-2 bg-stone-900 text-white rounded-lg px-4 py-2.5 mb-4">
      <span className="text-sm font-medium mr-2">{count} selected</span>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetStatus("active")}>
        <CheckCircle2 className="w-4 h-4 mr-1.5" /> Set Active
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSetStatus("archived")}>
        <Archive className="w-4 h-4 mr-1.5" /> Archive
      </Button>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => setConfirmOpen(true)}>
        <Trash2 className="w-4 h-4 mr-1.5" /> Delete
      </Button>
      <button onClick={onClear} className="ml-auto p-1 rounded hover:bg-white/10" aria-label="Clear selection">
        <X className="w-4 h-4" />
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {count} student{count > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected student records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => { setConfirmOpen(false); onDelete(); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}