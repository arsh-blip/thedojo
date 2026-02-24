"use client";

import type { ConceptData, CopyVariation } from "./concept-form";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Eye, Image, Target, Link as LinkIcon } from "lucide-react";

interface SlidePreviewProps {
  data: ConceptData;
}

function VariationSlide({
  variation,
  index,
  angle,
}: {
  variation: CopyVariation;
  index: number;
  angle: string;
}) {
  return (
    <div className="rounded-lg border bg-gradient-to-br from-background to-muted/30 p-6 shadow-sm">
      {/* Slide mock header */}
      <div className="mb-4 flex items-center justify-between">
        <Badge variant="outline" className="text-xs">
          Variation {index + 1}
        </Badge>
      </div>

      {/* Slide content area */}
      <div className="space-y-4">
        {/* Angle as title */}
        <h3 className="text-lg font-bold tracking-tight">{angle}</h3>

        {/* Hook as subtitle */}
        {variation.hook && (
          <p className="text-base font-medium text-primary/90 leading-snug">
            {variation.hook}
          </p>
        )}

        <Separator />

        {/* Body copy */}
        {variation.bodyCopy && (
          <p className="text-sm leading-relaxed text-foreground/80 whitespace-pre-wrap">
            {variation.bodyCopy}
          </p>
        )}

        {/* CTA */}
        {variation.cta && (
          <div className="pt-2">
            <span className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
              {variation.cta}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function SlidePreview({ data }: SlidePreviewProps) {
  const referenceUrlsList = data.referenceUrls
    .split("\n")
    .map((url) => url.trim())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Slide previews for each variation */}
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Eye className="h-4 w-4" />
          Slide Previews
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          {data.variations.map((variation, index) => (
            <VariationSlide
              key={index}
              variation={variation}
              index={index}
              angle={data.angle}
            />
          ))}
        </div>
      </div>

      <Separator />

      {/* Supporting details */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Visual description */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Image className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Visual Direction</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
              {data.visualDescription || "No visual description provided."}
            </p>
          </CardContent>
        </Card>

        {/* Target audience */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Target Audience</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {data.targetAudience || "No target audience specified."}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Reference URLs */}
      {referenceUrlsList.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Reference URLs</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {referenceUrlsList.map((url, i) => (
                <li key={i}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary underline-offset-4 hover:underline break-all"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
