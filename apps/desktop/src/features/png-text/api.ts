import type { PngTextInspection } from "@/bindings/media";
import { invokeHost } from "@/shared/host/invoke";

export const pngTextApi = {
  inspect: (id: string) => invokeHost<PngTextInspection>("inspect_png_text", { id }),
};
