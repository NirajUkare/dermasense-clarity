import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  image: z.string().regex(/^data:image\/(jpeg|png|webp);base64,/).max(12_000_000),
  site: z.string().trim().min(2).max(100),
  history: z.string().trim().max(1200),
});

const result = z.object({
  description: z.string(),
  impression: z.string(),
  differential: z.string(),
  recommendation: z.string(),
  imageQuality: z.string(),
});

export const assessImage = createServerFn({ method: "POST" })
  .validator((data) => input.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("Image assessment is not configured. Please contact the workspace owner.");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
        include: ["reasoning.encrypted_content"],
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: `You are drafting a cautious dermatology image observation for a licensed clinician. The photo alone cannot establish a diagnosis. Body site: ${data.site}. Clinical history: ${data.history || "Not supplied"}. Return ONLY a JSON object with exactly five concise string fields: description (objective visible morphology only), impression (a tentative clinical impression, explicitly uncertain), differential (2-3 plausible alternatives, no invented certainty), recommendation (reasonable next clinical evaluation steps, including in-person examination for concerning lesions), imageQuality (whether the image is sufficiently clear and any limitations). Do not claim measurements, dermoscopy findings, histology, a diagnosis, probabilities, urgency or treatment if not supported. If this is not a skin photo, state that in every relevant field and recommend a suitable image.` },
            { type: "input_image", image_url: data.image },
          ],
        }],
      }),
    });

    if (!response.ok) {
      let message = `Assessment unavailable (${response.status}).`;
      try {
        const body = await response.json() as { message?: string; error?: { message?: string } };
        message = body.message || body.error?.message || message;
      } catch { /* preserve status when the response has no JSON body */ }
      throw new Error(message);
    }
    if (!response.body) throw new Error("The assessment returned no response.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let text = "";
    let streamError = "";
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const frames = pending.split(/\r?\n\r?\n/);
      pending = frames.pop() ?? "";
      for (const frame of frames) {
        const payload = frame.split(/\r?\n/).filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as { type?: string; delta?: string; error?: { message?: string }; response?: { output?: { type?: string; content?: { type?: string; text?: string }[] }[] } };
          if (event.type === "response.output_text.delta") text += event.delta ?? "";
          if (event.type === "error" || event.type === "response.failed") streamError = event.error?.message || "The assessment could not be completed.";
          if (event.type === "response.completed" && !text) {
            text = event.response?.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("") ?? "";
          }
        } catch { /* ignore non-JSON heartbeat frames */ }
      }
      if (done) break;
    }
    if (streamError) throw new Error(streamError);
    if (!text.trim()) throw new Error("The assessment returned no findings. Please try again with a clearer image.");
    try {
      return result.parse(JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()));
    } catch {
      throw new Error("The assessment could not be formatted. Please try again.");
    }
  });