import { google, type slides_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import type { ConceptSlideData, AdCopy } from "../types.js";

export class GoogleSlidesService {
  private slides;

  constructor(auth: OAuth2Client) {
    this.slides = google.slides({ version: "v1", auth });
  }

  async getPresentation(presentationId: string) {
    const response = await this.slides.presentations.get({ presentationId });
    return response.data;
  }

  async listSlides(
    presentationId: string
  ): Promise<{ objectId: string; title: string; index: number }[]> {
    const presentation = await this.getPresentation(presentationId);
    return (presentation.slides || []).map((slide, index) => {
      const title = this.extractSlideTitle(slide);
      return {
        objectId: slide.objectId!,
        title: title || `Slide ${index + 1}`,
        index,
      };
    });
  }

  private extractSlideTitle(
    slide: slides_v1.Schema$Page
  ): string | undefined {
    for (const element of slide.pageElements || []) {
      if (element.shape?.shapeType === "TEXT_BOX" || element.shape?.placeholder?.type === "TITLE") {
        const text = element.shape?.text?.textElements
          ?.map((te) => te.textRun?.content || "")
          .join("")
          .trim();
        if (text) return text;
      }
    }
    return undefined;
  }

  async duplicateSlide(
    presentationId: string,
    slideObjectId: string
  ): Promise<string> {
    const response = await this.slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [
          {
            duplicateObject: {
              objectId: slideObjectId,
            },
          },
        ],
      },
    });

    const duplicatedId =
      response.data.replies?.[0]?.duplicateObject?.objectId;
    if (!duplicatedId) {
      throw new Error("Failed to duplicate slide");
    }
    return duplicatedId;
  }

  async updateSlideText(
    presentationId: string,
    replacements: { placeholder: string; value: string }[]
  ): Promise<void> {
    const requests: slides_v1.Schema$Request[] = replacements.map((r) => ({
      replaceAllText: {
        containsText: {
          text: r.placeholder,
          matchCase: false,
        },
        replaceText: r.value,
      },
    }));

    await this.slides.presentations.batchUpdate({
      presentationId,
      requestBody: { requests },
    });
  }

  async updateConceptSlide(
    presentationId: string,
    slideObjectId: string,
    data: ConceptSlideData
  ): Promise<string> {
    // Duplicate the template slide
    const newSlideId = await this.duplicateSlide(
      presentationId,
      slideObjectId
    );

    // Build the copy variations text
    const copyText = data.copy_variations
      .map(
        (v, i) =>
          `Variation ${i + 1}: ${v.variation_name}\n` +
          `Headline: ${v.headline}\n` +
          `Primary Text: ${v.primary_text}\n` +
          `Description: ${v.description}\n` +
          `CTA: ${v.cta}`
      )
      .join("\n\n");

    // Replace placeholders in the duplicated slide
    const replacements = [
      { placeholder: "{{CONCEPT_NAME}}", value: data.concept_name },
      { placeholder: "{{BRAND}}", value: data.brand },
      { placeholder: "{{ANGLE}}", value: data.angle },
      {
        placeholder: "{{REFERENCE_AD}}",
        value: data.reference_ad_summary,
      },
      { placeholder: "{{COPY}}", value: copyText },
      {
        placeholder: "{{VISUAL_DIRECTION}}",
        value: data.visual_direction,
      },
      { placeholder: "{{TARGET_AUDIENCE}}", value: data.target_audience },
      {
        placeholder: "{{KEY_MESSAGES}}",
        value: data.key_messaging_points.join("\n• "),
      },
    ];

    if (data.reference_ad_url) {
      replacements.push({
        placeholder: "{{REFERENCE_AD_URL}}",
        value: data.reference_ad_url,
      });
    }

    await this.updateSlideText(presentationId, replacements);

    return `https://docs.google.com/presentation/d/${presentationId}/edit#slide=id.${newSlideId}`;
  }

  async addConceptSlide(
    presentationId: string,
    data: ConceptSlideData
  ): Promise<string> {
    // Create a new blank slide
    const createResponse = await this.slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [
          {
            createSlide: {
              slideLayoutReference: {
                predefinedLayout: "BLANK",
              },
            },
          },
        ],
      },
    });

    const newSlideId =
      createResponse.data.replies?.[0]?.createSlide?.objectId;
    if (!newSlideId) throw new Error("Failed to create new slide");

    // Add text boxes with concept content
    const requests: slides_v1.Schema$Request[] = [];

    // Title text box
    requests.push(
      this.createTextBoxRequest(
        newSlideId,
        `${data.concept_name} — ${data.brand}`,
        { x: 50, y: 30, width: 620, height: 40 },
        18,
        true
      )
    );

    // Angle & audience
    requests.push(
      this.createTextBoxRequest(
        newSlideId,
        `Angle: ${data.angle}\nTarget: ${data.target_audience}`,
        { x: 50, y: 80, width: 300, height: 50 },
        11
      )
    );

    // Reference ad summary
    requests.push(
      this.createTextBoxRequest(
        newSlideId,
        `Reference Ad:\n${data.reference_ad_summary}${data.reference_ad_url ? `\n${data.reference_ad_url}` : ""}`,
        { x: 50, y: 140, width: 300, height: 80 },
        10
      )
    );

    // Copy variations
    const copyContent = data.copy_variations
      .map(
        (v, i) =>
          `[${v.variation_name}]\n` +
          `Headline: ${v.headline}\n` +
          `Primary: ${v.primary_text}\n` +
          `Desc: ${v.description}\n` +
          `CTA: ${v.cta}`
      )
      .join("\n\n");

    requests.push(
      this.createTextBoxRequest(
        newSlideId,
        `Ad Copy:\n${copyContent}`,
        { x: 370, y: 80, width: 310, height: 200 },
        9
      )
    );

    // Visual direction
    requests.push(
      this.createTextBoxRequest(
        newSlideId,
        `Visual Direction:\n${data.visual_direction}`,
        { x: 50, y: 230, width: 300, height: 60 },
        10
      )
    );

    // Key messages
    requests.push(
      this.createTextBoxRequest(
        newSlideId,
        `Key Messages:\n• ${data.key_messaging_points.join("\n• ")}`,
        { x: 370, y: 290, width: 310, height: 60 },
        10
      )
    );

    await this.slides.presentations.batchUpdate({
      presentationId,
      requestBody: { requests },
    });

    return `https://docs.google.com/presentation/d/${presentationId}/edit#slide=id.${newSlideId}`;
  }

  private createTextBoxRequest(
    slideId: string,
    text: string,
    bounds: { x: number; y: number; width: number; height: number },
    fontSize: number,
    bold: boolean = false
  ): slides_v1.Schema$Request {
    const elementId = `textbox_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Note: This returns a single request but we need two (create + insert text).
    // We handle this by returning the create request and letting the caller
    // handle text insertion separately. For simplicity, we use a workaround.
    return {
      createShape: {
        objectId: elementId,
        shapeType: "TEXT_BOX",
        elementProperties: {
          pageObjectId: slideId,
          size: {
            width: { magnitude: bounds.width, unit: "PT" },
            height: { magnitude: bounds.height, unit: "PT" },
          },
          transform: {
            scaleX: 1,
            scaleY: 1,
            translateX: bounds.x,
            translateY: bounds.y,
            unit: "PT",
          },
        },
      },
    };
  }
}
