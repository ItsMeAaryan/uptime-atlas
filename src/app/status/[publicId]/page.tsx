import { Suspense } from "react";
import Link from "next/link";
import { getStatusPageData } from "@/lib/services/status-page-service";
import PublicStatusPage from "@/components/public-status-page";

interface PageProps {
  params: Promise<{ publicId: string }>;
}

async function StatusPageContent({ params }: PageProps) {
  const { publicId } = await params;
  const data = await getStatusPageData(publicId);

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900/60 p-8 shadow-2xl space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800/80 text-slate-400 text-2xl font-bold">
            404
          </div>
          <h1 className="text-lg font-bold text-white tracking-tight">Status Page Not Found</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            This public status page does not exist or has been made private by its administrator.
          </p>
          <div className="pt-2">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition-colors"
            >
              Back to Uptime Atlas
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <PublicStatusPage initialData={data} publicId={publicId} />;
}

export default function StatusPageRoute({ params }: PageProps) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
          <div className="text-xs text-slate-400">Loading public status page...</div>
        </div>
      }
    >
      <StatusPageContent params={params} />
    </Suspense>
  );
}
