import { defineQuery } from "next-sanity";

import type { PortalProject } from "@/components/SiteCanvas";
import { client } from "@/sanity/lib/client";
import { urlFor } from "@/sanity/lib/image";

const PROJECTS_QUERY = defineQuery(`*[_type == "project" && defined(cover)] | order(order asc) {
  title,
  year,
  url,
  services,
  "images": [cover, ...content[_type == "projectGallery"].images[]]
}`);

export const PROJECTS_TAG = "project";

/**
 * Screenshots per project. Each project becomes one atlas texture; only the
 * current project and its neighbours are on the GPU at once (see SiteCanvas).
 * Six at 1600×1000 is about 8200 px with padding, so the atlas scales them
 * down by about 1% to fit its 8192 px.
 */
const MAX_IMAGES = 6;
/** Every screenshot is cropped to one aspect so the strip reads as a single column. */
const WIDTH = 1600;
const HEIGHT = 1000;

interface SanityProject {
  title: string;
  year?: string;
  url?: string;
  services?: string[];
  images: { asset?: { _ref: string } }[];
}

/** Asset refs carry their size: image-<hash>-<w>x<h>-<ext>. */
function isLandscape(ref: string) {
  const m = ref.match(/-(\d+)x(\d+)-/);
  return !!m && Number(m[1]) > Number(m[2]);
}

/**
 * The work projects, mapped for the portal. Phone screenshots are left out:
 * they would be cropped to nothing in a landscape strip.
 */
export async function getProjects(): Promise<PortalProject[]> {
  // Publishing in Studio fires a webhook that expires this tag (see
  // app/api/revalidate), so the hour is only a fallback. Skip the API CDN: a
  // refetch straight after a publish could otherwise still get the old set.
  const docs = await client
    .withConfig({ useCdn: false })
    .fetch<SanityProject[]>(
      PROJECTS_QUERY,
      {},
      { next: { revalidate: 3600, tags: [PROJECTS_TAG] } }
    );

  return docs.map((doc) => {
    const refs = [
      ...new Set(
        doc.images
          .map((img) => img.asset?._ref)
          .filter((ref): ref is string => !!ref && isLandscape(ref))
      ),
    ].slice(0, MAX_IMAGES);

    return {
      title: doc.title,
      meta: [...(doc.services ?? []).slice(0, 2), doc.year]
        .filter(Boolean)
        .join(" · "),
      url: doc.url,
      images: refs.map((ref) =>
        urlFor(ref).width(WIDTH).height(HEIGHT).fit("crop").auto("format").url()
      ),
    };
  });
}
