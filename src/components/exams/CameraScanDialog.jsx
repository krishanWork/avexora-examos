import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Check, X } from "lucide-react";

// Live camera capture with a frame guide and multi-shot "scan next sheet" flow.
export default function CameraScanDialog({ open, onOpenChange, onDone }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [captures, setCaptures] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setCaptures([]);
    setError("");
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera is not supported on this device or browser. Please use the file upload option instead.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      })
      .catch(() => setError("Camera unavailable or permission denied. Allow camera access in your browser and try again."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" });
        setCaptures((prev) => [...prev, { file, preview: URL.createObjectURL(blob) }]);
      },
      "image/jpeg",
      0.92
    );
  };

  const removeCapture = (i) => setCaptures((prev) => prev.filter((_, idx) => idx !== i));

  const finish = () => {
    const files = captures.map((c) => c.file);
    onOpenChange(false);
    onDone(files);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Scan OMR Sheets with Camera</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <div className="space-y-3">
            <div className="relative rounded-lg overflow-hidden bg-black aspect-[3/4] sm:aspect-video">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              {/* Frame guide */}
              <div className="absolute inset-4 border-2 border-dashed border-white/80 rounded-md pointer-events-none" />
              <p className="absolute bottom-2 inset-x-0 text-center text-[11px] text-white/90 pointer-events-none">
                Align the full OMR sheet inside the frame, hold steady, then capture
              </p>
            </div>

            {captures.length > 0 && (
              <div className="flex gap-2 overflow-x-auto py-1">
                {captures.map((c, i) => (
                  <div key={i} className="relative shrink-0">
                    <img src={c.preview} alt={`Sheet ${i + 1}`} className="h-16 w-12 object-cover rounded border border-stone-200" />
                    <button
                      onClick={() => removeCapture(i)}
                      className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5"
                      aria-label="Remove capture"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={capture} className="flex-1">
                <Camera className="w-4 h-4 mr-2" /> Capture Sheet {captures.length > 0 ? `(${captures.length} taken)` : ""}
              </Button>
              <Button variant="outline" onClick={finish} disabled={captures.length === 0}>
                <Check className="w-4 h-4 mr-2" /> Process {captures.length || ""}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}