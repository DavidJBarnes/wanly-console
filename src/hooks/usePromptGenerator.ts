import { useState } from "react";
import { generatePrompt } from "../api/client";

export function usePromptGenerator() {
  const [promptPrefix, setPromptPrefix] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  async function generate(
    source: { imageFile?: File; imageS3Uri?: string },
    onSuccess: (prompt: string) => void,
  ) {
    setGenError("");
    setGenerating(true);
    try {
      let image_base64: string | undefined;
      let image_s3_uri: string | undefined;

      if (source.imageFile) {
        image_base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Strip "data:image/...;base64," prefix
            resolve(result.split(",")[1]);
          };
          reader.onerror = reject;
          reader.readAsDataURL(source.imageFile!);
        });
      } else if (source.imageS3Uri) {
        image_s3_uri = source.imageS3Uri;
      } else {
        setGenError("No image available");
        setGenerating(false);
        return;
      }

      const result = await generatePrompt({
        image_base64: image_base64 ?? null,
        image_s3_uri: image_s3_uri ?? null,
        prompt_prefix: promptPrefix.trim() || null,
      });
      onSuccess(result.prompt);
    } catch (e: unknown) {
      const detail =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : undefined;
      setGenError(detail ?? "Prompt generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return { promptPrefix, setPromptPrefix, generating, genError, setGenError, generate };
}
