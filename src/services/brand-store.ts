import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import type {
  BrandProfile,
  BrandCreativeStrategy,
  CreativeStrategyPillar,
  StrategyMission,
  BrandReview,
  TopPerformingAd,
  BrandContext,
} from "../types.js";

/**
 * Persistent brand store — one folder per brand under a configurable root.
 *
 * Structure:
 *   brands/
 *     glossier/
 *       profile.json       — brand metadata
 *       strategy.json      — creative strategy pillars
 *       reviews.json       — gathered customer reviews
 *       top-ads.json       — top-performing ad references
 *     summer-fridays/
 *       ...
 */
export class BrandStore {
  private root: string;

  constructor(root?: string) {
    // Default to a `brands` folder next to the project root
    this.root = root || path.join(process.cwd(), "brands");
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private brandDir(slug: string): string {
    return path.join(this.root, slug);
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(filePath: string, data: unknown): Promise<void> {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  // ── Brand CRUD ────────────────────────────────────────────────────

  async createBrand(params: {
    name: string;
    product?: string;
    targetAudience?: string;
    brandVoice?: BrandProfile["brand_voice"];
  }): Promise<BrandProfile> {
    const slug = this.slugify(params.name);
    const dir = this.brandDir(slug);
    await fs.mkdir(dir, { recursive: true });

    const now = new Date().toISOString();
    const profile: BrandProfile = {
      slug,
      name: params.name,
      product: params.product,
      target_audience: params.targetAudience,
      brand_voice: params.brandVoice,
      created_at: now,
      updated_at: now,
    };

    await this.writeJson(path.join(dir, "profile.json"), profile);

    // Initialize empty collections if they don't exist
    const reviewsPath = path.join(dir, "reviews.json");
    const topAdsPath = path.join(dir, "top-ads.json");
    try {
      await fs.access(reviewsPath);
    } catch {
      await this.writeJson(reviewsPath, []);
    }
    try {
      await fs.access(topAdsPath);
    } catch {
      await this.writeJson(topAdsPath, []);
    }

    return profile;
  }

  async listBrands(): Promise<BrandProfile[]> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      const profiles: BrandProfile[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const profilePath = path.join(
            this.root,
            entry.name,
            "profile.json"
          );
          const profile = await this.readJson<BrandProfile | null>(
            profilePath,
            null
          );
          if (profile) profiles.push(profile);
        }
      }
      return profiles.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  async getBrandBySlug(slug: string): Promise<BrandProfile | null> {
    return this.readJson<BrandProfile | null>(
      path.join(this.brandDir(slug), "profile.json"),
      null
    );
  }

  /** Find a brand by name (case-insensitive) or slug */
  async findBrand(nameOrSlug: string): Promise<BrandProfile | null> {
    const slug = this.slugify(nameOrSlug);
    const direct = await this.getBrandBySlug(slug);
    if (direct) return direct;

    // Search by name
    const brands = await this.listBrands();
    return (
      brands.find(
        (b) => b.name.toLowerCase() === nameOrSlug.toLowerCase()
      ) || null
    );
  }

  // ── Strategy ──────────────────────────────────────────────────────

  async importStrategy(
    slug: string,
    pillars: CreativeStrategyPillar[],
    opts?: { product?: string; mission?: StrategyMission }
  ): Promise<BrandCreativeStrategy> {
    const dir = this.brandDir(slug);
    const strategy: BrandCreativeStrategy = {
      product: opts?.product,
      mission: opts?.mission,
      pillars,
      updated_at: new Date().toISOString(),
    };
    await this.writeJson(path.join(dir, "strategy.json"), strategy);
    return strategy;
  }

  async getStrategy(slug: string): Promise<BrandCreativeStrategy | null> {
    return this.readJson<BrandCreativeStrategy | null>(
      path.join(this.brandDir(slug), "strategy.json"),
      null
    );
  }

  // ── Reviews ───────────────────────────────────────────────────────

  async addReviews(
    slug: string,
    reviews: Omit<BrandReview, "id" | "added_at">[]
  ): Promise<BrandReview[]> {
    const filePath = path.join(this.brandDir(slug), "reviews.json");
    const existing = await this.readJson<BrandReview[]>(filePath, []);

    const newReviews: BrandReview[] = reviews.map((r) => ({
      ...r,
      id: crypto.randomUUID(),
      added_at: new Date().toISOString(),
    }));

    const all = [...existing, ...newReviews];
    await this.writeJson(filePath, all);
    return newReviews;
  }

  async getReviews(slug: string): Promise<BrandReview[]> {
    return this.readJson<BrandReview[]>(
      path.join(this.brandDir(slug), "reviews.json"),
      []
    );
  }

  // ── Top-Performing Ads ────────────────────────────────────────────

  async saveTopAd(
    slug: string,
    ad: Omit<TopPerformingAd, "id" | "added_at">
  ): Promise<TopPerformingAd> {
    const filePath = path.join(this.brandDir(slug), "top-ads.json");
    const existing = await this.readJson<TopPerformingAd[]>(filePath, []);

    const newAd: TopPerformingAd = {
      ...ad,
      id: crypto.randomUUID(),
      added_at: new Date().toISOString(),
    };

    existing.push(newAd);
    await this.writeJson(filePath, existing);
    return newAd;
  }

  async getTopAds(slug: string): Promise<TopPerformingAd[]> {
    return this.readJson<TopPerformingAd[]>(
      path.join(this.brandDir(slug), "top-ads.json"),
      []
    );
  }

  // ── Full Context ──────────────────────────────────────────────────

  /** Load everything for a brand — used by analysis tools */
  async getFullContext(slug: string): Promise<BrandContext | null> {
    const profile = await this.getBrandBySlug(slug);
    if (!profile) return null;

    const [strategy, reviews, top_ads] = await Promise.all([
      this.getStrategy(slug),
      this.getReviews(slug),
      this.getTopAds(slug),
    ]);

    return {
      profile,
      strategy: strategy || undefined,
      reviews,
      top_ads,
    };
  }
}

// Singleton
export const brandStore = new BrandStore();
