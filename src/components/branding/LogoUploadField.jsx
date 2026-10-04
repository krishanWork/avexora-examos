import React, { useState } from "react";
import { appClient } from "@/api/appClient";
import { Label } from "@/components/ui/label";
import { UploadCloud, X } from "lucide-react";

export default function LogoUploadField({ label, hint, value, onChange }) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { file_url } = await appClient.integrations.Core.UploadFile({ file, purpose: "logo" });
      onChange(file_url);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <Label>{label}</Label>
      {hint && <p className="text-xs text-stone-400 mb-1">{hint}</p>}
      <div className="flex items-center gap-3 mt-1">
        {value && (
          <div className="relative">
            <img src={value} alt={label} className="w-12 h-12 rounded object-contain border bg-white" />
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute -top-1.5 -right-1.5 bg-stone-700 text-white rounded-full p-0.5"
              aria-label="Remove"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <label className="inline-flex items-center gap-2 text-sm border border-stone-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-stone-50">
          <UploadCloud className="w-4 h-4" /> {uploading ? "Uploading..." : "Upload"}
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
    </div>
  );
}