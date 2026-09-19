import React, { useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import api, { errMsg } from '../lib/api';
import { clsx } from '../lib/format';
import { Button, Card, Chip, PageHeader, SkeletonRows, EmptyState } from '../components/ui.jsx';
import { useToast } from '../store/useToast';

export default function Documents() {
  const toast = useToast((s) => s.add);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 
      'text/csv': ['.csv'], 
      'application/vnd.ms-excel': ['.xls', '.xlsx'], 
      'application/json': ['.json'], 
      'application/xml': ['.xml', '.txt'] 
    },
    multiple: false,
    onDrop: (files) => setFile(files[0] || null),
  });

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/documents');
      setDocuments(data.documents);
    } catch (err) {
      toast.error(errMsg(err, 'Failed to fetch documents'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const doUpload = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/documents/upload', fd);
      toast.success(`${data.document.recordCount?.toLocaleString?.() || 0} records loaded from ${file.name}`);
      setFile(null);
      fetchDocuments();
    } catch (err) {
      toast.error(errMsg(err, 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Documents (RAG)"
        subtitle="Upload CSV, XLSX, JSON, or XML files to store them as JSON in MongoDB for processing."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Card className="p-4">
            <h3 className="text-header-md font-semibold mb-3">Upload new document</h3>
            <div
              {...getRootProps()}
              className={clsx(
                'cursor-pointer rounded-lg border border-dashed p-7 text-center transition-colors',
                isDragActive ? 'border-ledger-accent bg-ledger-accent/5' : 'border-ledger-line bg-white hover:border-ledger-accent'
              )}
            >
              <input {...getInputProps()} />
              {file ? (
                <div>
                  <p className="font-mono text-sm text-ledger-ink">{file.name}</p>
                  <p className="mt-1 text-small text-ledger-meta">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <p className="text-base font-medium text-ledger-ink">Drop file here</p>
                  <p className="mt-1 text-small text-ledger-meta">.csv, .xlsx, .json, .xml</p>
                </div>
              )}
            </div>
            {file && (
              <div className="mt-4 flex gap-2">
                <Button className="flex-1" onClick={doUpload} loading={busy}>
                  {busy ? 'Uploading...' : 'Upload & Parse'}
                </Button>
                <Button variant="outline" onClick={() => setFile(null)} disabled={busy}>Clear</Button>
              </div>
            )}
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="p-4">
            <h3 className="text-header-md font-semibold mb-3">Uploaded Documents</h3>
            {loading ? (
              <SkeletonRows rows={4} cols={3} />
            ) : documents.length === 0 ? (
              <EmptyState title="No documents yet" message="Upload a document to get started." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-ledger-line">
                <table className="w-full text-table">
                  <thead>
                    <tr className="border-b border-ledger-line bg-ledger-panel text-left text-small text-ledger-meta">
                      <th className="px-4 py-2 font-medium">Filename</th>
                      <th className="px-4 py-2 font-medium">Format</th>
                      <th className="px-4 py-2 font-medium">Role</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc, i) => (
                      <motion.tr
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        key={doc._id}
                        className="border-b border-ledger-line last:border-0 hover:bg-ledger-panel/50"
                      >
                        <td className="px-4 py-2 font-mono text-sm max-w-[200px] truncate">{doc.filename}</td>
                        <td className="px-4 py-2"><Chip tone="neutral">{doc.originalFormat}</Chip></td>
                        <td className="px-4 py-2 text-small capitalize">{doc.uploaderRole}</td>
                        <td className="px-4 py-2">
                          <Chip tone={doc.status === 'ready' ? 'match' : doc.status === 'failed' ? 'brk' : 'neutral'} dot>
                            {doc.status}
                          </Chip>
                        </td>
                        <td className="px-4 py-2 font-mono text-small">{doc.recordCount?.toLocaleString()}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
