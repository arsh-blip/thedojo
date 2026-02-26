"use client";

import { cn } from "@/lib/utils";
import type { BrandMeta } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Briefcase, FileText } from "lucide-react";

interface BrandListProps {
  brands: BrandMeta[];
  selectedSlug: string | null;
  onSelectBrand: (slug: string) => void;
}

export function BrandList({
  brands,
  selectedSlug,
  onSelectBrand,
}: BrandListProps) {
  if (brands.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-sm text-muted-foreground">
        No brands yet. Create one to get started.
      </div>
    );
  }

  return (
    <div className="space-y-1 p-2">
      {brands.map((brand) => {
        const active = brand.slug === selectedSlug;
        return (
          <button
            key={brand.slug}
            type="button"
            onClick={() => onSelectBrand(brand.slug)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors text-left",
              active
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            <Briefcase className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{brand.name}</span>
            {brand.messagingDocId && (
              <span title="Messaging doc linked"><FileText className="size-3 text-muted-foreground" /></span>
            )}
            <Badge variant="secondary" className="ml-auto shrink-0">
              {brand.analysisCount}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
