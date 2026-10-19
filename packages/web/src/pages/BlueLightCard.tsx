import { MarketingLayout } from "@/marketing/MarketingLayout";
import { useSeo } from "@/marketing/seo";
import { BlueLightCardPresenter } from "@/marketing/blc/BlueLightCardPresenter";
import { useBlcOffer } from "@/marketing/blc/useBlcOffer";
import { BLC_PATH } from "@/marketing/blc/blcOffer";

/**
 * `/blue-light-card` — the Blue Light Card member offer (PER-3). Container:
 * the logic is `useBlcOffer`, the render is `BlueLightCardPresenter`.
 *
 * Reached only through the affiliate link, so it is noindex and absent from
 * `public/sitemap.xml`; the app never mentions it.
 */
export function BlueLightCard() {
  const view = useBlcOffer();
  useSeo({
    title: "Blue Light Card member offer — Persistence",
    description:
      "20% off Persistence Premium and Premium+ for Blue Light Card members.",
    path: BLC_PATH,
    noindex: true,
  });
  return (
    <MarketingLayout>
      <BlueLightCardPresenter {...view} />
    </MarketingLayout>
  );
}

export default BlueLightCard;
