"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { video } from "@/lib/api-client";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText, FileVideo2, Loader2 } from "lucide-react";

interface ExportButtonsProps {
  analysisPath: string;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type ExportFormat = "premiere" | "csv" | "json";

export function ExportButtons({ analysisPath }: ExportButtonsProps) {
  const [loading, setLoading] = useState<Record<ExportFormat, boolean>>({
    premiere: false,
    csv: false,
    json: false,
  });

  const setFormatLoading = (format: ExportFormat, value: boolean) => {
    setLoading((prev) => ({ ...prev, [format]: value }));
  };

  const handleExportPremiere = async () => {
    setFormatLoading("premiere", true);
    try {
      const blob = await video.exportPremiere({ analysisPath });
      downloadBlob(blob, "rough-cut.xml");
      toast.success("Premiere XML downloaded");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Premiere export failed"
      );
    } finally {
      setFormatLoading("premiere", false);
    }
  };

  const handleExportCsv = async () => {
    setFormatLoading("csv", true);
    try {
      const blob = await video.exportCsv(analysisPath);
      downloadBlob(blob, "selects.csv");
      toast.success("CSV downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "CSV export failed");
    } finally {
      setFormatLoading("csv", false);
    }
  };

  const handleExportJson = async () => {
    setFormatLoading("json", true);
    try {
      const res = await fetch("/api/video/export/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisPath }),
      });
      if (!res.ok) throw new Error("JSON export failed");
      const blob = await res.blob();
      downloadBlob(blob, "analysis.json");
      toast.success("JSON downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "JSON export failed");
    } finally {
      setFormatLoading("json", false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Export Results</p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={handleExportPremiere}
          disabled={loading.premiere}
        >
          {loading.premiere ? (
            <Loader2 className="animate-spin" />
          ) : (
            <FileVideo2 />
          )}
          Premiere XML
        </Button>

        <Button
          variant="outline"
          onClick={handleExportCsv}
          disabled={loading.csv}
        >
          {loading.csv ? (
            <Loader2 className="animate-spin" />
          ) : (
            <FileSpreadsheet />
          )}
          CSV
        </Button>

        <Button
          variant="outline"
          onClick={handleExportJson}
          disabled={loading.json}
        >
          {loading.json ? (
            <Loader2 className="animate-spin" />
          ) : (
            <FileText />
          )}
          JSON
        </Button>
      </div>
    </div>
  );
}
