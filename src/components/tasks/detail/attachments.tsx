"use client";

import { DownloadIcon, FileIcon, Loader2Icon, PaperclipIcon, Trash2Icon, UploadIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { deleteAttachment, getAttachmentUrl, prepareAttachmentUpload, recordAttachment } from "@/actions/tasks";
import { LocalDateTime } from "@/components/time";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES } from "@/lib/tasks/constants";
import { displayName, formatBytes } from "@/lib/utils";

export type AttachmentRow = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by: string | null;
  uploader: { id: string; full_name: string; email: string } | null;
};

export function Attachments({
  taskId,
  attachments,
  canUpload,
  canDeleteAny,
  viewerId,
}: {
  taskId: string;
  attachments: AttachmentRow[];
  canUpload: boolean;
  canDeleteAny: boolean;
  viewerId: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function upload(file: File) {
    if (file.size > ATTACHMENT_MAX_BYTES) return void toast.error("Files must be 25 MB or smaller.");
    if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
      return void toast.error("This file type isn't allowed.");
    }
    setUploading(file.name);
    try {
      const prep = await prepareAttachmentUpload({ task_id: taskId, file_name: file.name, size_bytes: file.size, mime_type: file.type });
      if (!prep.ok) return void toast.error(prep.error);
      // Upload with the user's own session: storage RLS checks task access.
      const supabase = createClient();
      const { error } = await supabase.storage.from(prep.data.bucket).upload(prep.data.path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) return void toast.error(`Upload failed: ${error.message}`);
      const rec = await recordAttachment({
        task_id: taskId,
        storage_path: prep.data.path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      });
      if (!rec.ok) return void toast.error(rec.error);
      toast.success(`${file.name} attached`);
    } finally {
      setUploading(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function download(a: AttachmentRow) {
    setBusyId(a.id);
    const res = await getAttachmentUrl(a.id);
    setBusyId(null);
    if (!res.ok) return void toast.error(res.error);
    window.location.assign(res.data.url);
  }

  async function remove(a: AttachmentRow) {
    if (!window.confirm(`Remove ${a.file_name}?`)) return;
    setBusyId(a.id);
    const res = await deleteAttachment(a.id);
    setBusyId(null);
    if (!res.ok) toast.error(res.error);
    else toast.success("Attachment removed");
  }

  return (
    <section aria-labelledby="attachments-heading">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="attachments-heading" className="flex items-center gap-2 text-sm font-semibold">
          <PaperclipIcon className="size-4 text-muted-foreground" /> Attachments
          <span className="text-muted-foreground">{attachments.length}</span>
        </h2>
        {canUpload ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              accept={ATTACHMENT_MIME_TYPES.join(",")}
              aria-label="Choose file to attach"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button variant="outline" size="xs" onClick={() => inputRef.current?.click()} disabled={!!uploading}>
              {uploading ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </>
        ) : null}
      </div>
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files attached. Images, PDFs, Office documents, text and ZIP files up to 25 MB.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
              <FileIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{a.file_name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(a.size_bytes)} · {displayName(a.uploader)} · <LocalDateTime iso={a.created_at} />
                </div>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={`Download ${a.file_name}`} onClick={() => download(a)} disabled={busyId === a.id}>
                {busyId === a.id ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
              </Button>
              {canDeleteAny || a.uploaded_by === viewerId ? (
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${a.file_name}`} onClick={() => remove(a)} disabled={busyId === a.id}>
                  <Trash2Icon />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
