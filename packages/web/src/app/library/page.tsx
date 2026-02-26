"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { library } from "@/lib/api-client";
import { Header } from "@/components/layout/header";
import { BrandList } from "@/components/library/brand-list";
import { ClipBrowser } from "@/components/library/clip-browser";
import { CreateBrandDialog } from "@/components/library/create-brand-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Library, Loader2 } from "lucide-react";

export default function LibraryPage() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const {
    data: brands,
    isLoading: brandsLoading,
  } = useQuery({
    queryKey: ["library", "brands"],
    queryFn: () => library.listBrands(),
  });

  return (
    <>
      <Header
        title="Clip Library"
        description="Browse and search analyzed clips by brand"
        actions={
          <Button variant="outline" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Create Brand
          </Button>
        }
      />

      <div className="flex h-[calc(100vh-73px)]">
        {/* Left panel - Brand list */}
        <aside className="w-64 shrink-0 border-r">
          <div className="flex h-10 items-center border-b px-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Brands
            </span>
          </div>
          <div className="h-[calc(100%-40px)] overflow-y-auto">
            {brandsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <BrandList
                brands={brands ?? []}
                selectedSlug={selectedSlug}
                onSelectBrand={setSelectedSlug}
              />
            )}
          </div>
        </aside>

        {/* Right panel */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedSlug ? (
            <ScrollArea className="flex-1">
              <div className="p-4">
                <ClipBrowser brandSlug={selectedSlug} />
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center space-y-4">
                <Library className="h-12 w-12 mx-auto text-muted-foreground/50" />
                <div>
                  <h2 className="text-lg font-medium">
                    Select a brand to browse clips
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Choose a brand from the sidebar, or create a new one to get
                    started.
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setCreateDialogOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  Create Brand
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <CreateBrandDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={(brand) => setSelectedSlug(brand.slug)}
      />
    </>
  );
}
