import * as crypto from "crypto";
import type { ConceptIteration, ConceptSession } from "../types.js";

/**
 * In-memory store for concept refinement sessions.
 * Tracks video analysis context and iteration history so the agent
 * can build on previous proposals during iterative refinement.
 */
class ConceptSessionStore {
  private sessions = new Map<string, ConceptSession>();

  create(params: {
    videoId: string;
    brand: string;
    product?: string;
    targetAudience?: string;
    videoAnalysisSummary: string;
  }): ConceptSession {
    const id = crypto.randomUUID();
    const session: ConceptSession = {
      id,
      videoId: params.videoId,
      brand: params.brand,
      product: params.product,
      targetAudience: params.targetAudience,
      videoAnalysisSummary: params.videoAnalysisSummary,
      iterations: [],
      createdAt: new Date(),
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): ConceptSession | undefined {
    return this.sessions.get(id);
  }

  addIteration(
    sessionId: string,
    concept: string,
    feedback?: string
  ): ConceptIteration {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Concept session "${sessionId}" not found`);

    const iteration: ConceptIteration = {
      iterationNumber: session.iterations.length + 1,
      concept,
      feedback,
      timestamp: new Date(),
    };
    session.iterations.push(iteration);
    return iteration;
  }

  listSessions(): ConceptSession[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }
}

// Singleton instance shared across the MCP server lifetime
export const conceptSessions = new ConceptSessionStore();
