import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import moment from "moment";
import { Send, Mail, MessageSquare, AlertTriangle, CheckCircle2, Paperclip, GraduationCap, UserPlus } from "lucide-react";
import SendEmailDialog from "@/components/leads/SendEmailDialog";

import { StatusBadge } from "@/lib/statusTokens";

const MSG_STATUS_COLOR = {
  sent: "text-emerald-600",
  failed: "text-red-500",
  received: "text-indigo-600",
  delivered: "text-emerald-600",
  read: "text-stone-700",
};

const Field = ({ label, value, empty = "—" }) => (
  <div>
    <dt className="text-xs font-medium uppercase tracking-wide text-stone-400">{label}</dt>
    <dd className="mt-1 text-sm text-stone-800">{String(value ?? "").trim() !== "" ? value : <span className="text-stone-400 italic">{empty}</span>}</dd>
  </div>
);

const WhatsAppModes = [
  { value: "text", label: "Text" },
  { value: "template", label: "Template" },
  { value: "media", label: "Media" },
  { value: "buttons", label: "Buttons" },
  { value: "list", label: "List" },
  { value: "cta", label: "CTA" },
];

const MSG_TYPE_LABELS = {
  text: "Text", template: "Template", buttons: "Buttons", list: "List", cta: "CTA",
  image: "Image", video: "Video", audio: "Audio", document: "Document",
};

const slug = (str) => String(str || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

export default function LeadDetailsDialog({ lead, open, onClose, onChanged }) {
  const { toast } = useToast();
  const [status, setStatus] = useState(lead?.status || "new");
  const [emails, setEmails] = useState([]);
  const [whatsapp, setWhatsapp] = useState({ configured: false, lead_phone: "", messages: [] });
  const [capabilities, setCapabilities] = useState({ email_configured: false, whatsapp_configured: false });
  const [emailOpen, setEmailOpen] = useState(false);
  const [waText, setWaText] = useState("");
  const [sendingWa, setSendingWa] = useState(false);
  const [waMode, setWaMode] = useState("text");
  const [templates, setTemplates] = useState([]);
  const [waTemplate, setWaTemplate] = useState("");
  const [waHeader, setWaHeader] = useState("");
  const [waFooter, setWaFooter] = useState("");
  const [waButtons, setWaButtons] = useState(["", "", ""]);
  const [waListTitle, setWaListTitle] = useState("");
  const [waRows, setWaRows] = useState("");
  const [waCtaUrl, setWaCtaUrl] = useState("");
  const [waCtaButton, setWaCtaButton] = useState("");
  const [waMediaType, setWaMediaType] = useState("image");
  const [waMediaUrl, setWaMediaUrl] = useState("");
  const [waCaption, setWaCaption] = useState("");
  const [waFile, setWaFile] = useState(null);
  const [waFilePreview, setWaFilePreview] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [classes, setClasses] = useState([]);
  const [convertForm, setConvertForm] = useState({
    full_name: "",
    admission_number: "",
    class_name: "",
    section: "A",
    student_email: "",
    student_phone: "",
    parent_name: "",
    parent_phone: "",
    parent_email: "",
  });
  const [converting, setConverting] = useState(false);

  const load = async () => {
    if (!lead) return;
    setStatus(lead.status || "new");
    try {
      const [emailsRes, whatsappRes, settingsRes] = await Promise.all([
        appClient.lead.emailHistory(lead.id).catch(() => ({ emails: [] })),
        appClient.lead.whatsapp(lead.id).catch(() => ({ configured: false, lead_phone: "", messages: [] })),
        appClient.lead.getSettings().catch(() => ({ capabilities: { email_configured: false, whatsapp_configured: false } })),
      ]);
      setEmails(emailsRes.emails || []);
      setWhatsapp(whatsappRes);
      setCapabilities(settingsRes.capabilities || { email_configured: false, whatsapp_configured: false });
      setTemplates([]);
      setWaTemplate("");
      if (settingsRes.capabilities?.whatsapp_configured) {
        appClient.lead.whatsappTemplates(lead.id).then((res) => setTemplates(res.templates || [])).catch(() => setTemplates([]));
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { if (open) load(); }, [open, lead?.id]);

  const changeStatus = async (value) => {
    setStatus(value);
    try {
      await appClient.entities.Lead.update(lead.id, { status: value });
      onChanged?.();
    } catch (err) {
      toast({ title: "Failed to update status", description: err.message, variant: "destructive" });
      setStatus(lead.status || "new");
    }
  };

  const handleOpenConvert = async () => {
    try {
      const clsList = await appClient.entities.SchoolClass.filter({ tenant_id: lead.tenant_id }, "order").catch(() => []);
      setClasses(clsList);
      setConvertForm({
        full_name: lead.name || "",
        admission_number: `ADM-${Date.now().toString().slice(-6)}`,
        class_name: clsList[0]?.name || "Class 10",
        section: "A",
        student_email: lead.email || "",
        student_phone: lead.phone || "",
        parent_name: lead.name || "",
        parent_phone: lead.phone || "",
        parent_email: lead.email || "",
      });
      setConvertOpen(true);
    } catch {
      setConvertOpen(true);
    }
  };

  const handleExecuteConvert = async (e) => {
    e.preventDefault();
    setConverting(true);
    try {
      // 1. Create Student
      const studentPayload = {
        tenant_id: lead.tenant_id,
        full_name: convertForm.full_name.trim(),
        admission_number: convertForm.admission_number.trim(),
        class_name: convertForm.class_name,
        section: convertForm.section,
        student_email: convertForm.student_email.trim() || undefined,
        student_phone: convertForm.student_phone.trim() || undefined,
        parent_name: convertForm.parent_name.trim(),
        parent_phone: convertForm.parent_phone.trim(),
        status: "active",
      };
      const createdStudent = await appClient.entities.Student.create(studentPayload);

      // 2. Create Parent
      const parentPayload = {
        tenant_id: lead.tenant_id,
        full_name: convertForm.parent_name.trim(),
        phone: convertForm.parent_phone.trim(),
        email: convertForm.parent_email.trim() || undefined,
        status: "active",
      };
      const createdParent = await appClient.entities.Parent.create(parentPayload);

      // 3. Create Canonical ParentStudent relationship
      await appClient.entities.ParentStudent.create({
        tenant_id: lead.tenant_id,
        student_id: createdStudent.id,
        parent_id: createdParent.id,
        relationship: "guardian",
        is_primary: true,
      });

      // 4. Update Lead to closed
      await appClient.entities.Lead.update(lead.id, { status: "closed" });
      setStatus("closed");

      toast({
        title: "Lead Converted to Student Roster",
        description: `Enrolled ${convertForm.full_name} and created guardian record for ${convertForm.parent_name}.`,
      });

      setConvertOpen(false);
      onChanged?.();
    } catch (err) {
      toast({ title: "Conversion failed", description: err.message, variant: "destructive" });
    } finally {
      setConverting(false);
    }
  };

  const resetComposer = () => {
    setWaText("");
    setWaHeader("");
    setWaFooter("");
    setWaButtons(["", "", ""]);
    setWaListTitle("");
    setWaRows("");
    setWaCtaUrl("");
    setWaCtaButton("");
    setWaMediaUrl("");
    setWaCaption("");
    setWaFile(null);
    setWaFilePreview("");
  };

  const sendWhatsApp = async () => {
    setSendingWa(true);
    try {
      let payload;
      if (waMode === "template") {
        if (!waTemplate) throw new Error("Select a template to send");
        payload = { template_name: waTemplate };
      } else if (waMode === "buttons") {
        const buttons = waButtons.map((b) => b.trim()).filter(Boolean);
        if (!waText.trim()) throw new Error("Message body is required");
        if (buttons.length === 0) throw new Error("At least one button is required");
        payload = { body: waText, buttons, header: waHeader.trim() || undefined, footer: waFooter.trim() || undefined };
      } else if (waMode === "list") {
        const rows = waRows.split("\n").map((l) => l.trim()).filter(Boolean).map((l, i) => {
          const sep = l.indexOf("—");
          const title = (sep >= 0 ? l.slice(0, sep) : l).trim();
          const description = sep >= 0 ? l.slice(sep + 1).trim() : "";
          return { id: slug(title) || `opt_${i}`, title: title.slice(0, 24), description: description.slice(0, 72) };
        });
        if (!waText.trim()) throw new Error("Message body is required");
        if (rows.length === 0) throw new Error("Add at least one row (one per line)");
        payload = { body: waText, sections: [{ title: (waListTitle || "Options").slice(0, 24), rows }] };
      } else if (waMode === "cta") {
        if (!waText.trim()) throw new Error("Message body is required");
        if (!waCtaUrl.trim()) throw new Error("CTA URL is required");
        payload = { body: waText, url: waCtaUrl.trim(), button_text: waCtaButton.trim() || undefined, header: waHeader.trim() || undefined, footer: waFooter.trim() || undefined };
      } else {
        if (!waText.trim()) return;
        payload = { message: waText };
      }
      await appClient.lead.sendWhatsapp(lead.id, payload);
      resetComposer();
      load();
    } catch (err) {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    } finally {
      setSendingWa(false);
    }
  };

  const pickWaFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setWaFile(file);
    setWaFilePreview(URL.createObjectURL(file));
    const mime = String(file.type || "").toLowerCase();
    if (mime.startsWith("image/")) setWaMediaType("image");
    else if (mime.startsWith("video/")) setWaMediaType("video");
    else if (mime.startsWith("audio/")) setWaMediaType("audio");
    else setWaMediaType("document");
  };

  const sendMedia = async () => {
    setSendingWa(true);
    try {
      if (waFile) {
        const fd = new FormData();
        fd.append("file", waFile);
        if (waCaption.trim()) fd.append("caption", waCaption.trim());
        await appClient.lead.sendWhatsappMedia(lead.id, fd);
      } else {
        if (!waMediaUrl.trim()) throw new Error("Pick a file or paste a media URL");
        await appClient.lead.sendWhatsappMedia(lead.id, JSON.stringify({
          media_type: waMediaType,
          media_url: waMediaUrl.trim(),
          caption: waCaption.trim() || undefined,
        }));
      }
      resetComposer();
      load();
    } catch (err) {
      toast({ title: "Failed to send media", description: err.message, variant: "destructive" });
    } finally {
      setSendingWa(false);
    }
  };

  if (!open) return null;

  const phoneProvided = Boolean(whatsapp.lead_phone);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span>{lead.name}</span>
                <Badge variant="secondary">{lead.type === "demo" ? "Demo Request" : "Contact"}</Badge>
                <StatusBadge status={status} type="lead" />
              </DialogTitle>
              <DialogDescription className="mt-0.5">Received {moment(lead.created_date).format("DD MMM YYYY, HH:mm")}</DialogDescription>
            </div>
            <Button size="sm" variant="outline" onClick={handleOpenConvert} className="gap-1.5 text-xs h-8 shadow-sm">
              <GraduationCap className="w-3.5 h-3.5 text-indigo-600" /> Convert to Student
            </Button>
          </div>
        </DialogHeader>

        <Tabs defaultValue="overview">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="email"><Mail className="w-3.5 h-3.5 mr-1 inline" /> Email</TabsTrigger>
            <TabsTrigger value="whatsapp"><MessageSquare className="w-3.5 h-3.5 mr-1 inline" /> WhatsApp</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-4">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Name" value={lead.name} />
              <Field label="Email" value={lead.email} empty="Not provided" />
              <Field label="Phone" value={lead.phone} empty="Not provided" />
              <Field label="Organization" value={lead.organization} empty="Not provided" />
              <Field label="Preferred Date" value={lead.preferred_date ? moment(lead.preferred_date).format("DD MMM YYYY, HH:mm") : ""} empty="Not provided" />
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-stone-400">Status</dt>
                <dd className="mt-1">
                  <Select value={status} onValueChange={changeStatus}>
                    <SelectTrigger className="w-36"><span>{status}</span></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="contacted">Contacted</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </dd>
              </div>
              <Field label="Created" value={moment(lead.created_date).format("DD MMM YYYY, HH:mm")} />
              <Field label="Updated" value={lead.updated_date ? moment(lead.updated_date).format("DD MMM YYYY, HH:mm") : ""} />
            </dl>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-stone-400 mb-1">Message</p>
              <p className="text-sm text-stone-700 whitespace-pre-wrap bg-stone-50 border border-stone-200 rounded-lg p-3">
                {String(lead.message ?? "").trim() !== "" ? lead.message : <span className="text-stone-400 italic">No message provided</span>}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="email" className="mt-4">
            {!capabilities.email_configured && (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Email is not configured. Super Admin can enable it in Settings → Connection Settings.
              </div>
            )}
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={() => setEmailOpen(true)} disabled={!capabilities.email_configured}>
                <Mail className="w-4 h-4 mr-2" /> Send Email
              </Button>
            </div>
            <div className="space-y-3">
              {emails.length === 0 && <p className="text-sm text-stone-400 text-center py-6">No email communication yet.</p>}
              {emails.map((m) => (
                <div key={m.id} className="border border-stone-200 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-medium text-stone-800">{m.subject}</p>
                    <Badge className={MSG_STATUS_COLOR[m.status]}>{m.status}</Badge>
                  </div>
                  <p className="text-xs text-stone-500">{moment(m.created_date).format("DD MMM YYYY, HH:mm")}</p>
                  {m.attachments?.length > 0 && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Paperclip className="w-3.5 h-3.5 text-stone-400" />
                      {m.attachments.map((a, i) => (
                        <span key={i} className="text-xs text-stone-600 bg-stone-100 border border-stone-200 rounded px-2 py-0.5">
                          {a.filename}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.html_content ? (
                    <div
                      className="text-sm text-stone-600 mt-2 line-clamp-4 rich-content"
                      dangerouslySetInnerHTML={{ __html: m.html_content }}
                    />
                  ) : (
                    <p className="text-sm text-stone-600 mt-2 whitespace-pre-wrap line-clamp-4">{m.message}</p>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="whatsapp" className="mt-4">
            {!capabilities.whatsapp_configured && (
              <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                WhatsApp is not configured. Super Admin can enable it in Settings → Connection Settings.
              </div>
            )}
            {!phoneProvided && (
              <div className="flex items-center gap-2 text-sm text-stone-500 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 mb-3">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                WhatsApp unavailable — phone number not provided.
              </div>
            )}
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1 mb-3">
              {whatsapp.messages.length === 0 && <p className="text-sm text-stone-400 text-center py-6">No WhatsApp conversation yet.</p>}
              {whatsapp.messages.map((m) => {
                const outbound = m.direction === "outbound";
                const kind = m.msg_type || "text";
                return (
                  <div key={m.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${outbound ? "bg-violet-600 text-white" : "bg-stone-100 text-stone-800"}`}>
                      {kind !== "text" && (
                        <p className={`mb-1 text-[11px] uppercase tracking-wide font-semibold ${outbound ? "text-violet-200" : "text-stone-400"}`}>
                          {MSG_TYPE_LABELS[kind] || kind}
                        </p>
                      )}
                      {kind === "image" && m.media_url && (
                        <img src={m.media_url} alt={m.caption || "image"} referrerPolicy="no-referrer" className="max-w-full max-h-56 rounded-lg mb-1 border border-white/20" />
                      )}
                      {(kind === "video" || kind === "audio" || kind === "document") && m.media_url && (
                        <a href={m.media_url} target="_blank" rel="noopener noreferrer" className={`block text-xs underline break-all mb-1 ${outbound ? "text-violet-100" : "text-indigo-600"}`}>{m.media_url}</a>
                      )}
                      {m.message ? <p className="whitespace-pre-wrap">{m.message}</p> : null}
                      <p className={`mt-1 text-[11px] flex items-center gap-1 ${outbound ? "text-violet-200" : "text-stone-400"}`}>
                        {moment(m.created_date).format("DD MMM, HH:mm")}
                        {outbound && (m.status === "sent" || m.status === "delivered" || m.status === "read") && <CheckCircle2 className="w-3 h-3" />}
                        <span className="capitalize">{m.status}</span>
                      </p>
                      {m.provider_message_id ? <p className="mt-0.5 text-[11px] opacity-70 break-all">ID: {m.provider_message_id}</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="space-y-3 mb-3">
              <Select value={waMode} onValueChange={(v) => setWaMode(v)} disabled={!phoneProvided || !capabilities.whatsapp_configured}>
                <SelectTrigger className="w-full"><span>{WhatsAppModes.find((m) => m.value === waMode)?.label}</span></SelectTrigger>
                <SelectContent>
                  {WhatsAppModes.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>{mode.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {waMode === "template" && (
                <div className="space-y-2">
                  {templates.length === 0 && (
                    <p className="text-xs text-stone-500">No approved templates found. Create them in your WhatsApp provider.</p>
                  )}
                  <Select value={waTemplate} onValueChange={setWaTemplate} disabled={templates.length === 0 || sendingWa}>
                    <SelectTrigger className="w-full"><span>{waTemplate || "Select template..."}</span></SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-stone-400">Sends the approved provider template — ideal outside the 24-hour free-form window.</p>
                </div>
              )}

              {waMode === "media" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label className="cursor-pointer flex items-center gap-2 text-xs text-stone-600 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2">
                      <Paperclip className="w-4 h-4" /> Upload file
                      <input type="file" className="hidden" onChange={pickWaFile} accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" />
                    </Label>
                    {waFile && (
                      <span className="text-xs text-stone-500 truncate max-w-[40%]">{waFile.name}</span>
                    )}
                  </div>
                  {waFilePreview && waMediaType === "image" && <img src={waFilePreview} alt="preview" className="max-h-32 rounded-lg border border-stone-200" />}
                  <div className="flex items-center gap-2">
                    <Select value={waMediaType} onValueChange={setWaMediaType} disabled={sendingWa}>
                      <SelectTrigger className="w-32"><span>{waMediaType}</span></SelectTrigger>
                      <SelectContent>
                        {["image", "video", "audio", "document"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input placeholder="or paste a public media URL" value={waMediaUrl} onChange={(e) => setWaMediaUrl(e.target.value)} disabled={sendingWa} />
                  </div>
                  <Input placeholder="Caption (optional)" value={waCaption} onChange={(e) => setWaCaption(e.target.value)} disabled={sendingWa} />
                  <p className="text-xs text-stone-400">Requires a public URL — WhatsApp fetches media from our uploads or your pasted link.</p>
                </div>
              )}

              {waMode === "buttons" && (
                <div className="space-y-2">
                  <Input placeholder="Header (optional)" value={waHeader} onChange={(e) => setWaHeader(e.target.value)} disabled={sendingWa} />
                  {waButtons.map((b, i) => (
                    <Input key={i} placeholder={`Button ${i + 1}`} value={b} onChange={(e) => { const next = [...waButtons]; next[i] = e.target.value; setWaButtons(next); }} disabled={sendingWa} />
                  ))}
                  <Input placeholder="Footer (optional)" value={waFooter} onChange={(e) => setWaFooter(e.target.value)} disabled={sendingWa} />
                </div>
              )}

              {waMode === "list" && (
                <div className="space-y-2">
                  <Input placeholder="Menu title (optional)" value={waListTitle} onChange={(e) => setWaListTitle(e.target.value)} disabled={sendingWa} />
                  <Textarea placeholder={"Menu rows, one per line:\nTopic 1 — short description\nTopic 2 — short description"} value={waRows} onChange={(e) => setWaRows(e.target.value)} rows={4} disabled={sendingWa} />
                  <p className="text-xs text-stone-400">Row titles and descriptions are trimmed to 24 / 72 characters.</p>
                </div>
              )}

              {waMode === "cta" && (
                <div className="space-y-2">
                  <Input placeholder="CTA URL (https://...)" value={waCtaUrl} onChange={(e) => setWaCtaUrl(e.target.value)} disabled={sendingWa} />
                  <Input placeholder="Button text (e.g. Visit site)" value={waCtaButton} onChange={(e) => setWaCtaButton(e.target.value)} disabled={sendingWa} />
                  <Input placeholder="Header (optional)" value={waHeader} onChange={(e) => setWaHeader(e.target.value)} disabled={sendingWa} />
                  <Input placeholder="Footer (optional)" value={waFooter} onChange={(e) => setWaFooter(e.target.value)} disabled={sendingWa} />
                </div>
              )}

              <div className="flex items-center gap-2">
                <Input
                  placeholder={waMode === "buttons" || waMode === "list" || waMode === "cta" ? "Message body..." : waMode === "media" ? "Media goes in the fields above" : "Type a message..."}
                  value={waText}
                  onChange={(e) => setWaText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && waMode !== "media") { e.preventDefault(); sendWhatsApp(); } }}
                  disabled={!phoneProvided || !capabilities.whatsapp_configured || sendingWa || waMode === "media"}
                />
                {waMode === "media" ? (
                  <Button size="sm" onClick={sendMedia} disabled={!phoneProvided || !capabilities.whatsapp_configured || sendingWa || (!waFile && !waMediaUrl.trim())}>
                    <Paperclip className="w-4 h-4" /> Send
                  </Button>
                ) : (
                  <Button size="sm" onClick={sendWhatsApp} disabled={!phoneProvided || !capabilities.whatsapp_configured || sendingWa || (waMode !== "template" && !waText.trim())}>
                    <Send className="w-4 h-4" /> {waMode === "template" ? "Send Template" : "Send"}
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <SendEmailDialog
          open={emailOpen}
          onClose={() => setEmailOpen(false)}
          lead={lead}
          onSent={load}
        />
      </DialogContent>
    </Dialog>

    {/* Convert Lead to Student Dialog */}
    <Dialog open={convertOpen} onOpenChange={(openState) => !converting && setConvertOpen(openState)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-stone-900">
            <GraduationCap className="w-5 h-5 text-indigo-600" />
            Convert Lead to Enrolled Student
          </DialogTitle>
          <DialogDescription className="text-xs text-stone-500">
            Pre-populates admission roster and creates linked parent record automatically.
          </DialogDescription>
        </DialogHeader>

        <form id="convert-form" onSubmit={handleExecuteConvert} className="space-y-3 pt-1">
          <div>
            <Label className="text-xs">Student Full Name *</Label>
            <Input
              className="h-8 text-xs"
              value={convertForm.full_name}
              onChange={(e) => setConvertForm({ ...convertForm, full_name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs">Admission Number *</Label>
              <Input
                className="h-8 text-xs font-mono"
                value={convertForm.admission_number}
                onChange={(e) => setConvertForm({ ...convertForm, admission_number: e.target.value })}
                required
              />
            </div>
            <div>
              <Label className="text-xs">Assign Class *</Label>
              <Select
                value={convertForm.class_name}
                onValueChange={(val) => setConvertForm({ ...convertForm, class_name: val })}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Class" /></SelectTrigger>
                <SelectContent>
                  {classes.map((c) => (
                    <SelectItem key={c.id || c.name} value={c.name} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs">Section</Label>
              <Input
                className="h-8 text-xs"
                value={convertForm.section}
                onChange={(e) => setConvertForm({ ...convertForm, section: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">Student Phone</Label>
              <Input
                className="h-8 text-xs"
                value={convertForm.student_phone}
                onChange={(e) => setConvertForm({ ...convertForm, student_phone: e.target.value })}
              />
            </div>
          </div>

          <div className="border-t border-stone-100 pt-2 space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">Guardian Identity</p>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <Label className="text-xs">Parent / Guardian *</Label>
                <Input
                  className="h-8 text-xs"
                  value={convertForm.parent_name}
                  onChange={(e) => setConvertForm({ ...convertForm, parent_name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label className="text-xs">Guardian Phone *</Label>
                <Input
                  className="h-8 text-xs"
                  value={convertForm.parent_phone}
                  onChange={(e) => setConvertForm({ ...convertForm, parent_phone: e.target.value })}
                  required
                />
              </div>
            </div>
          </div>
        </form>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-stone-100">
          <Button variant="outline" onClick={() => setConvertOpen(false)} disabled={converting}>
            Cancel
          </Button>
          <Button type="submit" form="convert-form" disabled={converting} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 shadow-sm">
            <UserPlus className="w-4 h-4" />
            {converting ? "Enrolling..." : "Enroll Student & Close Lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
}