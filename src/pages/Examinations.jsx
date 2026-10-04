import React, { useEffect, useState } from "react";
import { useOutletContext, Link, useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { logAudit } from "@/lib/audit";
import PageHeader from "@/components/shared/PageHeader";
import EmptyState from "@/components/shared/EmptyState";
import ExamFormDialog from "@/components/exams/ExamFormDialog";
import ListPagination, { clampPage, pageSlice } from "@/components/shared/ListPagination";
import PullToRefresh from "@/components/shared/PullToRefresh";
import { Button } from "@/components/ui/button";
import { BookOpenCheck, Plus, Pencil } from "lucide-react";
import { TableSkeleton, ErrorCard } from "@/components/shared/Skeletons";
import { useToast } from "@/components/ui/use-toast";
import { StatusBadge } from "@/lib/statusTokens";

export default function Examinations() {
  const { user } = useOutletContext() || {};
  const { toast } = useToast();
  const navigate = useNavigate();
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 12;

  const load = async () => {
    if (!user?.tenant_id) return;
    setLoading(true);
    setError(null);
    try {
      setExams(await appClient.entities.Examination.filter({ tenant_id: user.tenant_id }, "-created_date"));
    } catch (err) {
      setError(err);
      toast({ title: "Failed to load examinations", description: "Please try again.", variant: "destructive" });
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [user?.tenant_id]);

  if (loading) return <TableSkeleton />;
  if (error) return <ErrorCard onRetry={load} />;

  const handleSave = async (data) => {
    try {
      if (editing) {
        await appClient.entities.Examination.update(editing.id, data);
        await logAudit({ user, action: "update", entity_type: "Examination", entity_id: editing.id, details: data.name });
        toast({ title: "Examination updated" });
        setDialogOpen(false);
        setEditing(null);
        load();
      } else {
        const created = await appClient.entities.Examination.create({ ...data, tenant_id: user.tenant_id });
        await logAudit({ user, action: "create", entity_type: "Examination", entity_id: created.id, details: data.name });
        toast({ title: "Examination created" });
        setDialogOpen(false);
        setEditing(null);
        navigate(`/examinations/${created.id}`);
      }
    } catch (err) {
      toast({ title: "Failed to save examination", description: err.message, variant: "destructive" });
    }
  };

  return (
    <PullToRefresh onRefresh={load}>
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <PageHeader
        title="Examinations"
        description="Create exams, design OMR sheets, process scans, and publish results."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Create Examination
          </Button>
        }
      />

      {!loading && exams.length === 0 ? (
        <EmptyState icon={BookOpenCheck} title="No examinations yet" description="Create your first examination to begin the OMR workflow." />
      ) : (
        <>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pageSlice(exams, clampPage(page, exams.length, PAGE_SIZE), PAGE_SIZE).map((e) => (
            <Link key={e.id} to={`/examinations/${e.id}`} className="bg-white rounded-2xl border border-stone-200 p-5 hover:border-stone-300 hover:shadow-md transition-all">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-heading font-semibold text-stone-900">{e.name}</h3>
                <div className="flex items-center gap-1">
                  <StatusBadge status={e.status} type="exam" />
                  <button
                    className="p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-stone-700"
                    onClick={(ev) => { ev.preventDefault(); setEditing(e); setDialogOpen(true); }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-sm text-stone-500">{e.subject} · {e.class_name || "-"}</p>
              <p className="text-xs text-stone-400 mt-2">{e.num_questions} questions · {e.max_marks} marks</p>
            </Link>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-stone-200 overflow-hidden empty:hidden">
          <ListPagination page={clampPage(page, exams.length, PAGE_SIZE)} totalItems={exams.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
        </>
      )}

      <ExamFormDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}
        onSave={handleSave}
        exam={editing}
        tenantId={user?.tenant_id}
      />
    </div>
    </PullToRefresh>
  );
}