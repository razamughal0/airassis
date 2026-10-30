import { describe, expect, it } from "vitest";
import { cosineSimilarity, embedQuery, hashEmbed } from "@/lib/knowledge/embeddings";
import { createSignedSession, verifySignedSession } from "@/lib/auth-token";

// The retriever module imports the database client; no query is executed in
// these unit tests, but the connection string must exist for module loading.
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const { detectIntent, expandQuery, keywordOverlap } = await import("@/lib/knowledge/retriever");

describe("intent detection", () => {
  it("maps admissions questions to the right retrieval intent", () => {
    expect(detectIntent("Show me the official fee structure for BS Artificial Intelligence")).toBe("fees");
    expect(detectIntent("What are the eligibility requirements for BS AI?")).toBe("eligibility");
    expect(detectIntent("What is the last date to apply for Fall 2026?")).toBe("deadline");
    expect(detectIntent("Which documents do I need to attach?")).toBe("documents");
    expect(detectIntent("How do I apply for admission?")).toBe("how-to-apply");
    expect(detectIntent("What is the merit scholarship policy?")).toBe("scholarship");
    expect(detectIntent("Is hostel available at Karachi Campus?")).toBe("facilities");
  });

  it("expands Roman Urdu questions into English retrieval variants", () => {
    const variants = expandQuery("Karachi campus ki fee kitni hai?");
    expect(variants.some((variant) => variant.includes("how much"))).toBe(true);
    const variants2 = expandQuery("admission ki aakhri tareekh kab hai?");
    expect(variants2.some((variant) => variant.includes("last date"))).toBe(true);
  });
});

describe("lexical scoring", () => {
  it("ranks exact numeric and program matches above unrelated text", () => {
    const relevant = keywordOverlap(
      "BS Artificial Intelligence fee",
      "BS Artificial Intelligence (BSAI) 9,150 17 155,550",
    );
    const irrelevant = keywordOverlap("BS Artificial Intelligence fee", "The library is open until 8pm on weekdays.");
    expect(relevant).toBeGreaterThan(irrelevant);
  });
});

describe("embedding provider", () => {
  it("is deterministic and normalized", async () => {
    const first = hashEmbed("Karachi campus admission fee for BS Artificial Intelligence");
    const second = hashEmbed("Karachi campus admission fee for BS Artificial Intelligence");
    expect(first).toEqual(second);
    const magnitude = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 3);
    expect(cosineSimilarity(first, second)).toBeCloseTo(1, 4);
  });

  it("scores related queries closer than unrelated ones", async () => {
    const query = await embedQuery("merit scholarship SGPA requirement", {
      provider: "hash",
      model: "hash-ngram-384",
    });
    const relevant = hashEmbed("Undergraduate students must score a minimum SGPA of 3.5 to qualify for the merit scholarship.");
    const unrelated = hashEmbed("The Karachi campus is located at PAF Airmen Academy, Korangi Creek.");
    expect(cosineSimilarity(query.vector, relevant)).toBeGreaterThan(cosineSimilarity(query.vector, unrelated));
  });
});

describe("administrator session tokens", () => {
  const secret = "test-secret";

  it("accepts a valid token and rejects tampering", () => {
    const token = createSignedSession(secret);
    expect(verifySignedSession(token, secret)).toBe(true);
    expect(verifySignedSession(token, "other-secret")).toBe(false);
    expect(verifySignedSession(`${token}x`, secret)).toBe(false);
    expect(verifySignedSession(undefined, secret)).toBe(false);
  });

  it("rejects expired tokens", () => {
    const issued = Date.now() - 1000 * 60 * 60 * 10;
    const token = createSignedSession(secret, issued);
    expect(verifySignedSession(token, secret)).toBe(false);
  });
});
