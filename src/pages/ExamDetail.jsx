import React, { useEffect, useState } from "react";
import { useParams, useOutletContext, Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import PageHeader from "@/components/shared/PageHeader";
import OMRPrintDialog from "@/components/exams/OMRPrintDialog";
import ExamWorkflowSteps from "@/components/exams/ExamWorkflowSteps";
import AnswerKeyPanel from "@/components/exams/AnswerKeyPanel";
import OMRUploadPanel from "@/components/exams/OMRUploadPanel";
import ResultsPanel from "@/components/exams/ResultsPanel";
import ReviewDashboard from "@/components/exams/review/ReviewDashboard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DetailSkeleton, ErrorCard } from "@/components/shared/Skeletons";
import { ArrowLeft, FileDown } from "lucide-react";

export default function ExamDetail() {
  const { id } = useParams();
  const { user, tenant } = useOutletContext() || {};
  const [examination, setExamination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [printOpen, setPrintOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const exam = await appClient.entities.Examination.get(id);
      if (!exam) throw new Error("Examination not found");
      setExamination(exam);
    } catch (err) {
      console.error("Failed to load examination:", err);
      setError("Examination details could not be loaded. Please check the ID or retry.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  if (loading) {
    return <DetailSkeleton />;
  }

  if (error || !examination) {
    return (
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-4">
        <Link to="/examinations" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800">
          <ArrowLeft className="w-4 h-4" /> Back to Examinations
        </Link>
        <ErrorCard message={error || "Examination not found"} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      <Link to="/examinations" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Examinations
      </Link>
      <PageHeader
        title={examination.name}
        description={`${examination.subject} · ${examination.class_name || "-"} · ${examination.num_questions} questions · ${examination.max_marks} marks`}
        actions={
          <Button variant="outline" onClick={() => setPrintOpen(true)}>
            <FileDown className="w-4 h-4 mr-2" /> Print OMR Sheets
          </Button>
        }
      />

      <ExamWorkflowSteps status={examination.status} />

      <Tabs defaultValue="answer-key">
        <TabsList>
          <TabsTrigger value="answer-key">Answer Key</TabsTrigger>
          <TabsTrigger value="omr">OMR Sheets</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
        </TabsList>
        <TabsContent value="answer-key" className="mt-4">
          <AnswerKeyPanel examination={examination} user={user} />
        </TabsContent>
        <TabsContent value="omr" className="mt-4">
          <OMRUploadPanel examination={examination} user={user} tenant={tenant} />
        </TabsContent>
        <TabsContent value="review" className="mt-4">
          <ReviewDashboard examination={examination} user={user} onExamUpdated={load} />
        </TabsContent>
        <TabsContent value="results" className="mt-4">
          <ResultsPanel examination={examination} user={user} tenant={tenant} onExamUpdated={load} />
        </TabsContent>
      </Tabs>

      <OMRPrintDialog open={printOpen} onOpenChange={setPrintOpen} examination={examination} tenant={tenant} />
    </div>
  );
}