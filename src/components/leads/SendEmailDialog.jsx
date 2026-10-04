import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Paperclip, X, FileText, Code2, Eye, PenLine } from "lucide-react";
import moment from "moment";

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

const htmlToText = (html) =>
  String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const MERGE_FIELDS = [
  { token: "{{name}}", label: "Name" },
  { token: "{{email}}", label: "Email" },
  { token: "{{organization}}", label: "Organization" },
  { token: "{{phone}}", label: "Phone" },
  { token: "{{message}}", label: "Lead message" },
  { token: "{{created_date}}", label: "Created date" },
];

const mergeTokenValues = (lead) => ({
  name: lead?.name ?? "",
  email: lead?.email ?? "",
  organization: lead?.organization ?? "",
  phone: lead?.phone ?? "",
  message: lead?.message ?? "",
  created_date: lead?.created_date ? moment(lead.created_date).format("DD MMM YYYY") : "",
});

const mergeTokens = (input, lead) =>
  String(input || "").replace(/\{\{\s*(name|email|organization|phone|message|created_date)\s*\}\}/g, (_, key) => mergeTokenValues(lead)[key] ?? "");

const toEditorFragment = (html) => {
  const s = String(html || "");
  if (!/<\s*(html|body)[\s>]|<!doctype/i.test(s)) return s;
  const doc = new DOMParser().parseFromString(s, "text/html");
  return doc.body ? doc.body.innerHTML : "";
};

const previewDocument = (html) => {
  const s = String(html || "");
  return /<\s*html[\s>]|<!doctype\s*html/i.test(s)
    ? s
    : `<!doctype html><html><head><meta charset="utf-8"></head><body>${s}</body></html>`;
};

const MODES = [
  { value: "write", label: "Rich Text", icon: PenLine },
  { value: "html", label: "HTML", icon: Code2 },
  { value: "preview", label: "Preview", icon: Eye },
];

export default function SendEmailDialog({ open, onClose, lead, onSent }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ subject: "", message: "" });
  const [attachments, setAttachments] = useState([]);
  const [mode, setMode] = useState("write");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const quillRef = useRef(null);
  const htmlRef = useRef(null);

  useEffect(() => {
    if (open) {
      setForm({ subject: "", message: "" });
      setAttachments([]);
      setMode("write");
      setError("");
    }
  }, [open]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!form.subject.trim()) { setError("Subject is required."); return; }
    if (!htmlToText(form.message)) { setError("Message is required."); return; }
    setSending(true);
    setError("");
    try {
      if (attachments.length > 0) {
        const fd = new FormData();
        fd.append("subject", form.subject.trim());
        fd.append("message", form.message);
        attachments.forEach((file) => fd.append("attachments", file, file.name));
        await appClient.lead.sendEmail(lead.id, fd);
      } else {
        await appClient.lead.sendEmail(lead.id, { subject: form.subject.trim(), message: form.message });
      }
      toast({ title: "Email sent", description: `Email delivered to ${lead.email}.` });
      onSent?.();
      onClose();
    } catch (err) {
      setError(err.message || "Email could not be sent. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const addFiles = useCallback((list) => {
    const incoming = Array.from(list || []).slice(0, MAX_ATTACHMENTS);
    const oversized = incoming.find((f) => f.size > MAX_ATTACHMENT_SIZE);
    if (oversized) {
      setError(`"${oversized.name}" exceeds the 10MB attachment limit.`);
      return;
    }
    setAttachments((prev) => [...prev, ...incoming].slice(0, MAX_ATTACHMENTS));
    setError("");
  }, []);

  const removeFile = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const insertToken = (token) => {
    if (mode === "html" && htmlRef.current) {
      const el = htmlRef.current;
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const next = `${form.message.slice(0, start)}${token}${form.message.slice(end)}`;
      setForm((prev) => ({ ...prev, message: next }));
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
      return;
    }
    if (mode === "write" && quillRef.current) {
      const editor = quillRef.current.getEditor();
      const sel = editor.getSelection();
      const index = sel ? sel.index : editor.getLength();
      editor.insertText(index, token);
      editor.setSelection(index + token.length);
      return;
    }
    setForm((prev) => ({ ...prev, message: `${prev.message}${token}` }));
  };

  const modules = useMemo(
    () => ({
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ["bold", "italic", "underline", "strike", "blockquote"],
        [{ list: "ordered" }, { list: "bullet" }, { color: [] }, { background: [] }],
        ["link", "image"],
        [{ align: [] }],
        ["clean"],
      ],
    }),
    []
  );

  const mergedHtml = mergeTokens(form.message, lead);

  return (
    <Dialog open={open} onOpenChange={() => { if (!sending) onClose(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Send Email</DialogTitle>
          <DialogDescription>
            Compose an email to this lead. The recipient is locked to their submitted address.
          </DialogDescription>
        </DialogHeader>
        <form id="lead-send-email" onSubmit={handleSend} className="space-y-4">
          <div>
            <Label htmlFor="lead-email-to">To</Label>
            <Input id="lead-email-to" value={lead.email || ""} readOnly className="mt-1 bg-stone-50 text-stone-500" />
          </div>
          <div>
            <Label htmlFor="lead-email-subject">Subject</Label>
            <Input
              id="lead-email-subject"
              className="mt-1"
              required
              placeholder="Subject"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label>Message</Label>
              <div className="inline-flex rounded-lg border border-stone-200 bg-stone-50 p-0.5">
                {MODES.map((m) => {
                  const Icon = m.icon;
                  const active = mode === m.value;
                  return (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMode(m.value)}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                        active ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {mode === "write" && (
              <div className="mt-1 email-rich-editor">
                <ReactQuill
                  ref={quillRef}
                  theme="snow"
                  value={toEditorFragment(form.message)}
                  onChange={(value) => setForm((prev) => ({ ...prev, message: value }))}
                  modules={modules}
                  placeholder="Write your message... Bold, italic, lists and links are supported. Use the paperclip below to attach documents or images."
                />
              </div>
            )}

            {mode === "html" && (
              <textarea
                ref={htmlRef}
                className="mt-1 w-full h-72 rounded-lg border border-stone-200 p-3 font-mono text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-300"
                placeholder={"<p>Write or paste an HTML template here...</p>\n\nAvailable merge fields: {{name}} {{email}} {{organization}} {{phone}} {{message}} {{created_date}}"}
                value={form.message}
                onChange={(e) => setForm((prev) => ({ ...prev, message: e.target.value }))}
              />
            )}

            {mode === "preview" && (
              <iframe
                title="Email preview"
                sandbox=""
                className="mt-1 w-full h-80 rounded-lg border border-stone-200 bg-white"
                srcDoc={previewDocument(mergedHtml)}
              />
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-stone-400">Insert:</span>
              {MERGE_FIELDS.map((f) => (
                <button
                  key={f.token}
                  type="button"
                  onClick={() => insertToken(f.token)}
                  className="text-xs text-stone-600 bg-stone-50 border border-stone-200 rounded-full px-2 py-0.5 hover:bg-stone-100"
                  title={f.token}
                >
                  {f.label}
                </button>
              ))}
              <span className="text-xs text-stone-300">·</span>
              <span className="text-xs text-stone-400">Values fill automatically on send</span>
            </div>
          </div>
          <div>
            <Label>Attachments</Label>
            <div className="mt-1 space-y-2">
              <label
                className="cursor-pointer flex items-center gap-2 text-sm text-stone-600 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2"
                htmlFor="lead-email-attachments"
              >
                <Paperclip className="w-4 h-4" /> Attach document or image
                <input
                  id="lead-email-attachments"
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
                />
              </label>
              {attachments.length > 0 && (
                <ul className="space-y-1">
                  {attachments.map((file, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
                      <FileText className="w-4 h-4 shrink-0 text-stone-400" />
                      <span className="truncate flex-1" title={file.name}>{file.name}</span>
                      <span className="text-xs text-stone-400 shrink-0">{formatBytes(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="shrink-0 text-stone-400 hover:text-red-500"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {attachments.length >= MAX_ATTACHMENTS && (
                <p className="text-xs text-stone-400">Attachment limit reached (10 files).</p>
              )}
            </div>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button type="submit" form="lead-send-email" disabled={sending}>
            {sending ? "Sending..." : "Send Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}