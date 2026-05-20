import { UploadForm } from "./UploadForm";

export default function NewBookPage() {
  return (
    <main className="max-w-2xl mx-auto p-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">New Book</h1>
        <p className="text-muted-foreground mt-1">Upload a PDF — we'll detect chapters automatically.</p>
      </header>
      <UploadForm />
    </main>
  );
}
