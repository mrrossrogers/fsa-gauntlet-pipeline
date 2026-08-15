const FALLBACKS = {
  food: {
    url: "https://www.foodsexalcohol.com/images/food.png",
    alt: "A quiet kitchen table set with bread, herbs, a ceramic plate, and a pan in soft window light.",
  },
  sex: {
    url: "https://www.foodsexalcohol.com/images/romance.png",
    alt: "Two chairs, two water glasses, folded linens, and a private note in soft morning light.",
  },
  alcohol: {
    url: "https://www.foodsexalcohol.com/images/hero.png",
    alt: "A single cocktail, a glass of water, and a folded napkin on a quiet bar at dusk.",
  },
};

function httpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function fallbackImage(category) {
  const selected = FALLBACKS[category] || FALLBACKS.food;
  return {
    source: "original_fsa",
    asset: {
      role: "hero",
      url: selected.url,
      source_url: selected.url,
      credit: "Original FSA editorial artwork",
      license: "Original artwork created for FSA",
      caption: "",
      alt: selected.alt,
    },
  };
}

export function chooseArticleImage({ article }) {
  const existing = (article?.image_brief?.assets || []).find((asset) => asset?.role === "hero" && httpsUrl(asset?.url));
  if (existing) return { source: "editor_selected", asset: existing };
  return fallbackImage(article?.category);
}
