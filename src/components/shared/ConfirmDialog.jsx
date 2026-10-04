import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "destructive",
  loading = false,
  onConfirm,
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <AlertDialogContent className="max-w-md rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription className="text-sm text-stone-500 leading-relaxed">{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading} className="rounded-lg">Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading || !onConfirm}
            onClick={(e) => {
              e.preventDefault();
              onConfirm?.();
            }}
            className={cn(
              "rounded-lg",
              variant === "destructive" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-indigo-600 hover:bg-indigo-700 text-white"
            )}
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}