"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { slides, type DriveItem } from "@/lib/api-client";
import { toast } from "sonner";
import { Header } from "@/components/layout/header";
import { PresentationPicker } from "@/components/concept/presentation-picker";
import {
  ConceptForm,
  createEmptyConceptData,
  type ConceptData,
} from "@/components/concept/concept-form";
import { SlidePreview } from "@/components/concept/slide-preview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Presentation,
  FileText,
  Eye,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Step = "pick" | "form" | "preview" | "push";

const STEPS: { key: Step; label: string; icon: React.ElementType }[] = [
  { key: "pick", label: "Select Presentation", icon: Presentation },
  { key: "form", label: "Build Concept", icon: FileText },
  { key: "preview", label: "Preview", icon: Eye },
  { key: "push", label: "Push to Slides", icon: Upload },
];

function StepIndicator({
  steps,
  currentStep,
}: {
  steps: typeof STEPS;
  currentStep: Step;
}) {
  const currentIndex = steps.findIndex((s) => s.key === currentStep);

  return (
    <nav className="flex items-center gap-2">
      {steps.map((step, index) => {
        const Icon = step.icon;
        const isActive = step.key === currentStep;
        const isCompleted = index < currentIndex;

        return (
          <div key={step.key} className="flex items-center gap-2">
            {index > 0 && (
              <div
                className={cn(
                  "h-px w-8 transition-colors",
                  isCompleted ? "bg-primary" : "bg-border"
                )}
              />
            )}
            <div
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                isActive &&
                  "bg-primary text-primary-foreground",
                isCompleted &&
                  "bg-primary/10 text-primary",
                !isActive &&
                  !isCompleted &&
                  "bg-muted text-muted-foreground"
              )}
            >
              {isCompleted ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">{step.label}</span>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export default function ConceptPage() {
  const [step, setStep] = useState<Step>("pick");
  const [presentation, setPresentation] = useState<DriveItem | null>(null);
  const [conceptData, setConceptData] = useState<ConceptData>(
    createEmptyConceptData()
  );
  const [pushResult, setPushResult] = useState<{
    success: boolean;
    presentationId: string;
  } | null>(null);

  const pushMutation = useMutation({
    mutationFn: () => {
      if (!presentation) throw new Error("No presentation selected");

      const payload: Record<string, unknown> = {
        angle: conceptData.angle,
        variations: conceptData.variations,
        visualDescription: conceptData.visualDescription,
        targetAudience: conceptData.targetAudience,
        referenceUrls: conceptData.referenceUrls
          .split("\n")
          .map((u) => u.trim())
          .filter(Boolean),
      };

      return slides.pushConcept(presentation.id, payload);
    },
    onSuccess: () => {
      toast.success("Concept pushed to Google Slides successfully!");
      setPushResult({
        success: true,
        presentationId: presentation!.id,
      });
    },
    onError: (err: Error) => {
      toast.error(`Failed to push concept: ${err.message}`);
    },
  });

  function handlePresentationSelect(item: DriveItem) {
    setPresentation(item);
  }

  function handleConceptSubmit(data: ConceptData) {
    setConceptData(data);
    setStep("preview");
  }

  function handlePush() {
    pushMutation.mutate();
  }

  function handleReset() {
    setStep("pick");
    setPresentation(null);
    setConceptData(createEmptyConceptData());
    setPushResult(null);
  }

  return (
    <>
      <Header
        title="Concepts"
        description="Build and push concept slides to Google Slides"
        actions={
          <StepIndicator steps={STEPS} currentStep={step} />
        }
      />

      <div className="mx-auto max-w-4xl p-6">
        {/* Step 1: Pick Presentation */}
        {step === "pick" && (
          <Card>
            <CardHeader>
              <CardTitle>Select a Presentation</CardTitle>
              <CardDescription>
                Search for an existing Google Slides presentation or create a new
                one to push your concept into.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <PresentationPicker
                value={presentation}
                onChange={handlePresentationSelect}
              />
              <Separator />
              <div className="flex justify-end">
                <Button
                  onClick={() => setStep("form")}
                  disabled={!presentation}
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Concept Form */}
        {step === "form" && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>Build Your Concept</CardTitle>
                {presentation && (
                  <Badge variant="outline" className="ml-auto">
                    <Presentation className="mr-1 h-3 w-3" />
                    {presentation.name}
                  </Badge>
                )}
              </div>
              <CardDescription>
                Fill in the concept details. Add multiple copy variations to test
                different hooks and messaging.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ConceptForm
                value={conceptData}
                onChange={setConceptData}
                onSubmit={handleConceptSubmit}
              />
              <Separator />
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep("pick")}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Preview */}
        {step === "preview" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>Preview Concept</CardTitle>
                  {presentation && (
                    <Badge variant="outline" className="ml-auto">
                      <Presentation className="mr-1 h-3 w-3" />
                      {presentation.name}
                    </Badge>
                  )}
                </div>
                <CardDescription>
                  Review your concept before pushing to Google Slides.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SlidePreview data={conceptData} />
              </CardContent>
            </Card>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("form")}>
                <ArrowLeft className="h-4 w-4" />
                Edit Concept
              </Button>
              <Button onClick={() => setStep("push")}>
                Continue to Push
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 4: Push to Slides */}
        {step === "push" && (
          <Card>
            <CardHeader>
              <CardTitle>Push to Google Slides</CardTitle>
              <CardDescription>
                Push your concept into the selected presentation.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!pushResult && (
                <>
                  {/* Summary before push */}
                  <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                    <div className="flex items-center gap-3">
                      <Presentation className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          {presentation?.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {presentation?.id}
                        </p>
                      </div>
                    </div>
                    <Separator />
                    <div className="grid gap-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Angle</span>
                        <span className="font-medium">{conceptData.angle}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Copy Variations
                        </span>
                        <span className="font-medium">
                          {conceptData.variations.length}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Target Audience
                        </span>
                        <span className="font-medium">
                          {conceptData.targetAudience}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between">
                    <Button
                      variant="outline"
                      onClick={() => setStep("preview")}
                      disabled={pushMutation.isPending}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Back to Preview
                    </Button>
                    <Button
                      onClick={handlePush}
                      disabled={pushMutation.isPending}
                    >
                      {pushMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Pushing...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4" />
                          Push to Slides
                        </>
                      )}
                    </Button>
                  </div>
                </>
              )}

              {pushResult?.success && (
                <div className="space-y-4 text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <CheckCircle2 className="h-8 w-8 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">
                      Concept Pushed Successfully
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Your concept has been added to the Google Slides
                      presentation.
                    </p>
                  </div>
                  <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                    <Button asChild>
                      <a
                        href={`https://docs.google.com/presentation/d/${pushResult.presentationId}/edit`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open in Google Slides
                      </a>
                    </Button>
                    <Button variant="outline" onClick={handleReset}>
                      Create Another Concept
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
