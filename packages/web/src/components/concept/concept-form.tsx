"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plus, Trash2 } from "lucide-react";

export interface CopyVariation {
  hook: string;
  bodyCopy: string;
  cta: string;
}

export interface ConceptData {
  angle: string;
  variations: CopyVariation[];
  visualDescription: string;
  targetAudience: string;
  referenceUrls: string;
}

interface ConceptFormProps {
  value: ConceptData;
  onChange: (data: ConceptData) => void;
  onSubmit: (data: ConceptData) => void;
}

function createEmptyVariation(): CopyVariation {
  return { hook: "", bodyCopy: "", cta: "" };
}

export function createEmptyConceptData(): ConceptData {
  return {
    angle: "",
    variations: [createEmptyVariation()],
    visualDescription: "",
    targetAudience: "",
    referenceUrls: "",
  };
}

export function ConceptForm({ value, onChange, onSubmit }: ConceptFormProps) {
  function updateField<K extends keyof ConceptData>(
    field: K,
    fieldValue: ConceptData[K]
  ) {
    onChange({ ...value, [field]: fieldValue });
  }

  function updateVariation(
    index: number,
    field: keyof CopyVariation,
    fieldValue: string
  ) {
    const updated = value.variations.map((v, i) =>
      i === index ? { ...v, [field]: fieldValue } : v
    );
    updateField("variations", updated);
  }

  function addVariation() {
    updateField("variations", [...value.variations, createEmptyVariation()]);
  }

  function removeVariation(index: number) {
    if (value.variations.length <= 1) return;
    updateField(
      "variations",
      value.variations.filter((_, i) => i !== index)
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(value);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Angle */}
      <div className="space-y-2">
        <Label htmlFor="angle">Angle</Label>
        <Input
          id="angle"
          placeholder="e.g. Social proof / Before-after / Ingredient spotlight"
          value={value.angle}
          onChange={(e) => updateField("angle", e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">
          The strategic angle or approach for this ad concept.
        </p>
      </div>

      {/* Copy Variations */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">Copy Variations</h3>
            <p className="text-xs text-muted-foreground">
              Add one or more hook + body copy + CTA combinations.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addVariation}
          >
            <Plus className="h-4 w-4" />
            Add Copy Variation
          </Button>
        </div>

        {value.variations.map((variation, index) => (
          <Card key={index}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">
                  Variation {index + 1}
                </CardTitle>
                {value.variations.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => removeVariation(index)}
                    title="Remove variation"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor={`hook-${index}`}>Hook</Label>
                <Textarea
                  id={`hook-${index}`}
                  placeholder="The attention-grabbing opening line..."
                  value={variation.hook}
                  onChange={(e) =>
                    updateVariation(index, "hook", e.target.value)
                  }
                  rows={2}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`body-${index}`}>Body Copy</Label>
                <Textarea
                  id={`body-${index}`}
                  placeholder="The main body text of the ad..."
                  value={variation.bodyCopy}
                  onChange={(e) =>
                    updateVariation(index, "bodyCopy", e.target.value)
                  }
                  rows={4}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`cta-${index}`}>CTA</Label>
                <Input
                  id={`cta-${index}`}
                  placeholder="e.g. Shop Now / Learn More / Get Started"
                  value={variation.cta}
                  onChange={(e) =>
                    updateVariation(index, "cta", e.target.value)
                  }
                  required
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Separator />

      {/* Visual Description */}
      <div className="space-y-2">
        <Label htmlFor="visual-description">Visual Description</Label>
        <Textarea
          id="visual-description"
          placeholder="Describe the visual concept, imagery, layout, and art direction..."
          value={value.visualDescription}
          onChange={(e) => updateField("visualDescription", e.target.value)}
          rows={4}
          required
        />
      </div>

      {/* Target Audience */}
      <div className="space-y-2">
        <Label htmlFor="target-audience">Target Audience</Label>
        <Input
          id="target-audience"
          placeholder="e.g. Women 25-34 interested in skincare"
          value={value.targetAudience}
          onChange={(e) => updateField("targetAudience", e.target.value)}
          required
        />
      </div>

      {/* Reference URLs */}
      <div className="space-y-2">
        <Label htmlFor="reference-urls">Reference URLs</Label>
        <Textarea
          id="reference-urls"
          placeholder={"https://example.com/ad1\nhttps://example.com/ad2"}
          value={value.referenceUrls}
          onChange={(e) => updateField("referenceUrls", e.target.value)}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          One URL per line. Links to reference ads or inspiration.
        </p>
      </div>

      {/* Submit */}
      <Button type="submit" className="w-full">
        Continue to Preview
      </Button>
    </form>
  );
}
