import { describe, expect, it } from "vitest";
import { importSettingsSchema, referenceMetadataSchema, sampleTargetSchema, tagsSchema, uploadedFileSchema } from "./references";

const base = {
  name: " Dog bark ",
  description: "",
  categoryId: "3f1c1b9e-8d0e-4b7a-9c55-2f0f2b7d9a10",
  tags: "Dog, bark , outdoor dog,dog",
  visibility: "public",
  isSynthetic: false,
  license: "CC0-1.0",
  sourceUrl: "https://freesound.org/s/1",
  attribution: "",
};

describe("reference metadata", () => {
  it("normalizes names, empty fields and tags", () => {
    const parsed = referenceMetadataSchema.parse(base);
    expect(parsed).toMatchObject({ name: "Dog bark", description: null, attribution: null, tags: ["dog", "bark", "outdoor-dog"] });
  });

  it("requires a license and a source link or attribution", () => {
    expect(referenceMetadataSchema.safeParse({ ...base, license: " " }).success).toBe(false);
    const noSource = referenceMetadataSchema.safeParse({ ...base, sourceUrl: "", attribution: "" });
    expect(noSource.error?.issues[0]?.message).toMatch(/source link or an attribution/);
    expect(referenceMetadataSchema.safeParse({ ...base, sourceUrl: "", attribution: "Jane Doe" }).success).toBe(true);
  });

  it("rejects non-http links and bad tags", () => {
    expect(referenceMetadataSchema.safeParse({ ...base, sourceUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(tagsSchema.safeParse("ok, bad!tag").success).toBe(false);
    expect(tagsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `t${i}`).join(",")).success).toBe(false);
  });

  it("accepts only safe storage paths", () => {
    expect(uploadedFileSchema.safeParse({ storagePath: "piano/grand/069_A4_v80.wav", originalFilename: "A4.wav" }).success).toBe(true);
    for (const storagePath of ["piano/../x.wav", "/abs.wav", "piano/A#4.wav", "piano/a.mp3"]) {
      expect(uploadedFileSchema.safeParse({ storagePath, originalFilename: null }).success, storagePath).toBe(false);
    }
  });

  it("validates sample targets and import settings", () => {
    expect(sampleTargetSchema.parse({ instrumentId: base.categoryId, variant: "Grand-Default", midiNote: 69, velocity: null }).variant).toBe("grand-default");
    expect(sampleTargetSchema.safeParse({ instrumentId: base.categoryId, variant: "bad variant", midiNote: 69, velocity: null }).success).toBe(false);
    expect(sampleTargetSchema.safeParse({ instrumentId: base.categoryId, variant: "a", midiNote: 128, velocity: null }).success).toBe(false);
    expect(
      importSettingsSchema.safeParse({ instrumentId: base.categoryId, variant: "salamander", visibility: "public", license: "CC-BY-3.0", sourceUrl: "", attribution: "" })
        .success,
    ).toBe(false);
  });
});
