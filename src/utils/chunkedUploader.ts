/**
 * Resilient Chunked Uploader
 * Slices large files (especially videos and large documents) into 4MB chunks
 * to bypass proxy / Cloud Run 32MB payload limits and timeouts.
 */

export interface UploadResult {
  success: boolean;
  filePath: string;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  mediaType: 'video' | 'image' | 'document';
  size: number;
  originalSize: number;
  compressed?: boolean;
}

export async function uploadMediaWithChunks(
  file: File,
  onProgress?: (percent: number, statusText: string) => void
): Promise<UploadResult> {
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks - completely avoids Cloud Run 32MB HTTP limit
  const isLarge = file.size > CHUNK_SIZE;

  // For small files (< 4MB), attempt direct upload first
  if (!isLarge) {
    if (onProgress) onProgress(20, 'Uploading media...');
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const resText = await res.text();
    let data: any;
    try {
      data = JSON.parse(resText);
    } catch {
      throw new Error(`Upload server error (HTTP ${res.status}): Please retry`);
    }

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to upload media file');
    }

    if (onProgress) onProgress(100, 'Upload complete!');
    return data;
  }

  // For large files / videos, perform chunked upload
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const uploadId = `upl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const chunkBlob = file.slice(start, end);

    const formData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', String(i));
    formData.append('totalChunks', String(totalChunks));
    formData.append('fileName', file.name);
    formData.append('chunk', chunkBlob);

    const percent = Math.round(((i + 1) / totalChunks) * 85);
    if (onProgress) {
      onProgress(percent, `Uploading chunk ${i + 1} of ${totalChunks} (${percent}%)...`);
    }

    const res = await fetch(`/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&chunkIndex=${i}`, {
      method: 'POST',
      body: formData
    });

    const resText = await res.text();
    let chunkData: any;
    try {
      chunkData = JSON.parse(resText);
    } catch {
      throw new Error(`Chunk ${i + 1} upload failed (HTTP ${res.status}): Proxy error`);
    }

    if (!res.ok || !chunkData.success) {
      throw new Error(chunkData.error || `Chunk ${i + 1} rejected by server`);
    }
  }

  if (onProgress) onProgress(90, 'Assembling chunks & optimizing video with FFmpeg...');

  // Finalize & assemble chunks on server
  const completeRes = await fetch('/api/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uploadId,
      fileName: file.name,
      totalChunks,
      originalSize: file.size,
      mimeType: file.type
    })
  });

  const completeText = await completeRes.text();
  let completeData: any;
  try {
    completeData = JSON.parse(completeText);
  } catch {
    throw new Error(`Video assembly error (HTTP ${completeRes.status})`);
  }

  if (!completeRes.ok || !completeData.success) {
    throw new Error(completeData.error || 'Failed to assemble video');
  }

  if (onProgress) onProgress(100, 'Upload and compression complete!');
  return completeData;
}
