/** Unknown and failed assessments remain visible; only an explicit NSFW verdict is blurred. */
export function shouldBlurImage(
  status: string | undefined,
  blurNsfw: boolean,
  details: boolean,
  blurDetails: boolean,
) {
  return status === "nsfw" && blurNsfw && (!details || blurDetails);
}
