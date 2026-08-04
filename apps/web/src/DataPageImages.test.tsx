import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageGridCell } from './DataPageImages.js';

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ImageGridCell', () => {
  it('uploads an image and stores its file reference in the cell', async () => {
    const onSave = vi.fn(async () => undefined);
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith('/file-upload-sessions')) {
        return json({
          uploadId: '019fbcf9-e020-71da-935a-6a6a728b3790',
          uploadUrl: 'https://uploads.example.test/image',
          headers: { 'content-type': 'image/png' },
        });
      }
      if (url === 'https://uploads.example.test/image') return new Response(null, { status: 200 });
      if (url.endsWith('/file-upload-sessions/019fbcf9-e020-71da-935a-6a6a728b3790/complete')) {
        return json({
          id: '019fbcf9-e020-71da-935a-6a6a728b3791',
          original_name: 'inspection.png',
          content_type: 'image/png',
          size_bytes: 3,
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const file = new File([new Uint8Array([1, 2, 3])], 'inspection.png', {
      type: 'image/png',
    });
    if (!file.arrayBuffer) {
      Object.defineProperty(file, 'arrayBuffer', {
        value: async () => new Uint8Array([1, 2, 3]).buffer,
      });
    }

    render(
      <ImageGridCell
        base="/workspaces/workspace-1/projects/project-1"
        editable
        label="Inspection photo"
        recordName="Sample A"
        value={[]}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText('Sample A의 Inspection photo 이미지 파일 선택'), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(['019fbcf9-e020-71da-935a-6a6a728b3791']),
    );
    const issued = requests.find(({ url }) => url.endsWith('/file-upload-sessions'));
    expect(JSON.parse(String(issued?.init?.body))).toMatchObject({
      originalName: 'inspection.png',
      contentType: 'image/png',
      sizeBytes: 3,
    });
    expect(
      requests.find(({ url }) => url === 'https://uploads.example.test/image')?.init,
    ).toMatchObject({ method: 'PUT' });
  });

  it('loads a thumbnail and removes the existing reference', async () => {
    const onSave = vi.fn(async () => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        url: 'https://images.example.test/inspection.png',
        expiresIn: 300,
        file: {
          id: '019fbcf9-e020-71da-935a-6a6a728b3791',
          originalName: 'inspection.png',
          contentType: 'image/png',
          sizeBytes: 42,
        },
      }),
    );

    render(
      <ImageGridCell
        base="/workspaces/workspace-1/projects/project-1"
        editable
        label="Inspection photo"
        recordName="Sample A"
        value={['019fbcf9-e020-71da-935a-6a6a728b3791']}
        onSave={onSave}
      />,
    );

    expect(await screen.findByAltText('Sample A — Inspection photo')).toHaveAttribute(
      'src',
      'https://images.example.test/inspection.png',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Sample A의 Inspection photo 이미지 제거' }),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([]));
  });
});
