import type { AdSearchParams, AdSearchResult, FacebookAd } from "../types.js";

const META_GRAPH_API = "https://graph.facebook.com/v21.0";

export class MetaAdLibraryService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async searchAds(params: AdSearchParams): Promise<AdSearchResult> {
    const queryParams = new URLSearchParams({
      access_token: this.accessToken,
      search_terms: params.search_terms,
      ad_reached_countries: JSON.stringify(params.ad_reached_countries),
      ad_type: params.ad_type || "ALL",
      ad_active_status: params.ad_active_status || "ACTIVE",
      limit: String(params.limit || 10),
      fields: [
        "id",
        "ad_creation_time",
        "ad_delivery_start_time",
        "ad_delivery_stop_time",
        "ad_creative_bodies",
        "ad_creative_link_captions",
        "ad_creative_link_descriptions",
        "ad_creative_link_titles",
        "ad_snapshot_url",
        "page_id",
        "page_name",
        "bylines",
        "publisher_platforms",
        "estimated_audience_size",
      ].join(","),
    });

    if (params.search_page_ids?.length) {
      queryParams.set(
        "search_page_ids",
        JSON.stringify(params.search_page_ids)
      );
    }
    if (params.media_type) {
      queryParams.set("media_type", params.media_type);
    }

    const url = `${META_GRAPH_API}/ads_archive?${queryParams.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        `Meta Ad Library API error: ${error.error?.message || response.statusText}`
      );
    }

    const data = await response.json();

    return {
      ads: data.data as FacebookAd[],
      total_count: data.data?.length || 0,
    };
  }

  async getAdsByPage(
    pageId: string,
    country: string = "US",
    limit: number = 10
  ): Promise<FacebookAd[]> {
    const result = await this.searchAds({
      search_terms: "",
      ad_reached_countries: [country],
      search_page_ids: [pageId],
      limit,
    });
    return result.ads;
  }

  formatAdForDisplay(ad: FacebookAd): string {
    const lines: string[] = [
      `**${ad.page_name}** (ID: ${ad.id})`,
      `Started: ${ad.ad_delivery_start_time}`,
    ];

    if (ad.ad_creative_link_titles?.length) {
      lines.push(`Headlines: ${ad.ad_creative_link_titles.join(" | ")}`);
    }
    if (ad.ad_creative_bodies?.length) {
      lines.push(`Body copy: ${ad.ad_creative_bodies[0]}`);
    }
    if (ad.ad_creative_link_descriptions?.length) {
      lines.push(`Description: ${ad.ad_creative_link_descriptions[0]}`);
    }
    if (ad.publisher_platforms?.length) {
      lines.push(`Platforms: ${ad.publisher_platforms.join(", ")}`);
    }
    if (ad.ad_snapshot_url) {
      lines.push(`Preview: ${ad.ad_snapshot_url}`);
    }

    return lines.join("\n");
  }
}
