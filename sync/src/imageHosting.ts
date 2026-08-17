export type ImageHosting = "sqlite" | "gcs";

export function parseImageHosting(value: string | undefined): ImageHosting {
  const hosting = value ?? "sqlite";
  if (hosting !== "sqlite" && hosting !== "gcs") {
    throw new Error(`Invalid image hosting "${hosting}". Expected "sqlite" or "gcs".`);
  }
  return hosting;
}
