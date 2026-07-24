import { describe, expect, it } from "vitest";
import {
  buildBodyFromDisplay,
  mentionMarker,
  parseMentionIds,
  parseMentions,
  splitBody,
  toPlainText,
} from "@/lib/mentions";

/**
 * Pure @-mention marker helpers (E3). The comment body is the single source of
 * truth for who's mentioned — these parse/serialize the `@[Name](memberId)`
 * marker syntax the DAL and UI both rely on.
 */

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("parseMentions / parseMentionIds", () => {
  it("extracts name + memberId from markers, in order", () => {
    const body = `Hey ${mentionMarker("Jane Doe", ID_A)}, ping ${mentionMarker(
      "Bob",
      ID_B,
    )}`;
    const tokens = parseMentions(body);
    expect(tokens.map((t) => t.name)).toEqual(["Jane Doe", "Bob"]);
    expect(tokens.map((t) => t.memberId)).toEqual([ID_A, ID_B]);
  });

  it("de-dupes ids (same member mentioned twice)", () => {
    const body = `${mentionMarker("Jane", ID_A)} and ${mentionMarker("Jane", ID_A)}`;
    expect(parseMentionIds(body)).toEqual([ID_A]);
  });

  it("returns nothing for a body with no markers", () => {
    expect(parseMentionIds("just plain text @notamarker")).toEqual([]);
  });

  it("accepts an opaque (non-uuid) member id — better-auth ids aren't uuids", () => {
    // Validity is enforced against org membership downstream, not by the parser.
    expect(parseMentionIds("@[Jane](m_abc123)")).toEqual(["m_abc123"]);
  });

  it("does not match a malformed marker (space in the id)", () => {
    expect(parseMentionIds("@[Jane](bad id)")).toEqual([]);
  });
});

describe("splitBody / toPlainText", () => {
  it("splits into text + mention segments", () => {
    const body = `Hi ${mentionMarker("Jane Doe", ID_A)}!`;
    expect(splitBody(body)).toEqual([
      { type: "text", value: "Hi " },
      { type: "mention", name: "Jane Doe", memberId: ID_A },
      { type: "text", value: "!" },
    ]);
  });

  it("collapses markers to @Name for plain text", () => {
    const body = `Hi ${mentionMarker("Jane Doe", ID_A)}!`;
    expect(toPlainText(body)).toBe("Hi @Jane Doe!");
  });
});

describe("buildBodyFromDisplay", () => {
  it("replaces each inserted mention's @Name with its marker", () => {
    const body = buildBodyFromDisplay("Hi @Jane Doe and @Bob", [
      { name: "Jane Doe", memberId: ID_A },
      { name: "Bob", memberId: ID_B },
    ]);
    expect(body).toBe(
      `Hi ${mentionMarker("Jane Doe", ID_A)} and ${mentionMarker("Bob", ID_B)}`,
    );
    // Round-trips back to the two ids.
    expect(parseMentionIds(body)).toEqual([ID_A, ID_B]);
  });

  it("prefers the longer name so @Jane Doe wins over @Jane", () => {
    const body = buildBodyFromDisplay("ping @Jane Doe", [
      { name: "Jane", memberId: ID_B },
      { name: "Jane Doe", memberId: ID_A },
    ]);
    expect(parseMentionIds(body)).toEqual([ID_A]);
  });

  it("leaves an un-selected @name as plain text (no marker)", () => {
    const body = buildBodyFromDisplay("hi @stranger", [
      { name: "Jane", memberId: ID_A },
    ]);
    expect(parseMentionIds(body)).toEqual([]);
    expect(body).toBe("hi @stranger");
  });

  it("does not match @Jane inside a hyphenated @Jane-Doe", () => {
    const body = buildBodyFromDisplay("hi @Jane-Doe", [
      { name: "Jane", memberId: ID_A },
    ]);
    expect(body).toBe("hi @Jane-Doe");
    expect(parseMentionIds(body)).toEqual([]);
  });

  it("treats a name with regex replacement tokens literally (no $& expansion)", () => {
    const body = buildBodyFromDisplay("ping @A$&B", [
      { name: "A$&B", memberId: ID_A },
    ]);
    // The literal name survives; $& did not expand to the matched text.
    expect(body).toContain("$&");
    expect(parseMentionIds(body)).toEqual([ID_A]);
  });
});
