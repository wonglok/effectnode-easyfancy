import {
  SOCIAL_ALT,
  SOCIAL_SIZE,
  renderSocialCard,
} from "@/lib/social-card";

export const alt = SOCIAL_ALT;
export const size = SOCIAL_SIZE;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return renderSocialCard();
}
