"use client";

import { Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { uploadFile } from "./upload";

/**
 * Page-level "Upload media" control for the D4 library (top-right, per the
 * mockup). Reuses the shared presigned upload flow (`uploadFile`); unlike the
 * composer's MediaCard it only records to the library (no per-platform attach),
 * then `router.refresh()`es so the new assets appear. Accepts multiple files;
 * shows a compact progress state and surfaces per-file errors inline.
 */
export function UploadMediaButton({ brandId }: { brandId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setPending(true);
    setErrors([]);
    let uploaded = 0;
    for (const file of files) {
      try {
        setProgress(0);
        await uploadFile(brandId, file, setProgress);
        uploaded += 1;
      } catch (error) {
        setErrors((prev) => [
          ...prev,
          `${file.name}: ${error instanceof Error ? error.message : "upload failed."}`,
        ]);
      }
    }
    setPending(false);
    setProgress(0);
    // Reflect the new assets (and any usage counts) without a full reload.
    if (uploaded > 0) router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        disabled={pending}
        onClick={() => inputRef.current?.click()}
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {`Uploading… ${progress}%`}
          </>
        ) : (
          <>
            <Upload className="size-4" />
            Upload media
          </>
        )}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void handleFiles(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      {errors.length > 0 && (
        <div
          role="alert"
          className="max-w-xs text-right text-xs text-destructive"
        >
          {errors.map((err, i) => (
            <p key={i}>{err}</p>
          ))}
        </div>
      )}
    </div>
  );
}
