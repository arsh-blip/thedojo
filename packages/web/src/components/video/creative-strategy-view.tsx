"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CreativeStrategyRow } from "@/lib/api-client";

function parseProblemSolutionPromise(text: string) {
  const sections: { label: string; content: string }[] = [];
  const prefixes = ["PROBLEM:", "SOLUTION:", "PROMISE:"] as const;

  for (const prefix of prefixes) {
    const idx = text.indexOf(prefix);
    if (idx === -1) continue;

    const start = idx + prefix.length;
    // Find the next prefix after this one, or use end of string
    let end = text.length;
    for (const other of prefixes) {
      if (other === prefix) continue;
      const otherIdx = text.indexOf(other, start);
      if (otherIdx !== -1 && otherIdx < end) {
        end = otherIdx;
      }
    }

    sections.push({
      label: prefix.replace(":", ""),
      content: text.slice(start, end).trim(),
    });
  }

  return sections;
}

function splitLines(text: string): string[] {
  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function priorityVariant(priority: number) {
  if (priority === 1) return "default" as const;
  if (priority === 2) return "secondary" as const;
  return "outline" as const;
}

function StrategyCard({ row }: { row: CreativeStrategyRow }) {
  const [expanded, setExpanded] = useState(false);

  const pspSections = parseProblemSolutionPromise(row.problemSolutionPromise);
  const headlines = splitLines(row.exampleHeadline);
  const ugcHooks = splitLines(row.exampleUGCHook);
  const keyPoints = splitLines(row.keyPointsFraming);
  const beforeAfterItems = splitLines(row.beforeAfterFrameworks);
  const objectionItems = splitLines(row.objections);
  const subAngles = row.subAngles
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const primaryBenefits = row.primaryBenefits
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{row.namingConvention}</Badge>
          <Badge variant={priorityVariant(row.priority)} className="text-xs">
            P{row.priority}
          </Badge>
        </div>
        <CardTitle className="text-base">{row.angle}</CardTitle>
        <p className="text-sm text-muted-foreground">{row.persona}</p>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-6">
          {/* Description */}
          {row.description && (
            <section className="space-y-1">
              <h4 className="text-sm font-semibold">Description</h4>
              <p className="text-sm text-muted-foreground">{row.description}</p>
            </section>
          )}

          {/* Sub-Angles */}
          {subAngles.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-sm font-semibold">Sub-Angles</h4>
              <p className="text-sm text-muted-foreground">
                {subAngles.join(", ")}
              </p>
            </section>
          )}

          {/* Primary Benefits */}
          {primaryBenefits.length > 0 && (
            <section className="space-y-1">
              <h4 className="text-sm font-semibold">Primary Benefits</h4>
              <p className="text-sm text-muted-foreground">
                {primaryBenefits.join(", ")}
              </p>
            </section>
          )}

          {/* Emotional Fear */}
          {row.emotionalFear && (
            <section className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 dark:border-orange-900 dark:bg-orange-950/30">
              <h4 className="text-sm font-semibold text-orange-800 dark:text-orange-300">
                Emotional Fear
              </h4>
              <p className="mt-1 text-sm italic text-orange-700 dark:text-orange-400">
                {row.emotionalFear}
              </p>
            </section>
          )}

          {/* Problem > Solution > Promise */}
          {pspSections.length > 0 && (
            <section className="space-y-3">
              <h4 className="text-sm font-semibold">
                Problem &gt; Solution &gt; Promise
              </h4>
              {pspSections.map((section) => (
                <div key={section.label} className="space-y-0.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {section.label}
                  </p>
                  <p className="text-sm">{section.content}</p>
                </div>
              ))}
            </section>
          )}

          {/* Before/After Frameworks */}
          {beforeAfterItems.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold">
                Before/After Frameworks
              </h4>
              <ul className="list-disc space-y-1 pl-5">
                {beforeAfterItems.map((item, i) => (
                  <li
                    key={i}
                    className="text-sm text-muted-foreground"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Example Headlines */}
          {headlines.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold">Example Headlines</h4>
              <ol className="list-decimal space-y-1 pl-5">
                {headlines.map((headline, i) => (
                  <li
                    key={i}
                    className="text-sm text-muted-foreground"
                  >
                    {headline}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Example Testimonial */}
          {row.exampleTestimonial && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold">Example Testimonial</h4>
              <blockquote className="border-l-4 border-muted-foreground/30 pl-4 text-sm italic text-muted-foreground">
                {row.exampleTestimonial}
              </blockquote>
            </section>
          )}

          {/* Example UGC Hooks */}
          {ugcHooks.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold">Example UGC Hooks</h4>
              <ul className="list-disc space-y-1 pl-5">
                {ugcHooks.map((hook, i) => (
                  <li
                    key={i}
                    className="text-sm text-muted-foreground"
                  >
                    {hook}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Key Points / Framing */}
          {keyPoints.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold">Key Points / Framing</h4>
              <ol className="list-decimal space-y-1 pl-5">
                {keyPoints.map((point, i) => (
                  <li
                    key={i}
                    className="text-sm text-muted-foreground"
                  >
                    {point}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Objections */}
          {objectionItems.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-semibold">Objections</h4>
              <div className="space-y-2">
                {objectionItems.map((item, i) => (
                  <div
                    key={i}
                    className="rounded-md border px-3 py-2 text-sm text-muted-foreground"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </section>
          )}
        </CardContent>
      )}

      <div className="px-6 pb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-muted-foreground"
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      </div>
    </Card>
  );
}

export function CreativeStrategyView({
  rows,
}: {
  rows: CreativeStrategyRow[];
}) {
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        <p className="text-sm">No creative strategy data available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {rows.map((row, i) => (
        <StrategyCard key={`${row.namingConvention}-${row.angle}-${i}`} row={row} />
      ))}
    </div>
  );
}
