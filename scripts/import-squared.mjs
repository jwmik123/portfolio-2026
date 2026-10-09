/**
 * Copies the web projects from the Squared Sanity project into this one.
 * English translations win where they exist; images are re-uploaded, Mux
 * videos are referenced by their public playback ID. Safe to re-run: ids
 * are stable (project-<slug>) and Sanity dedupes uploaded assets.
 *
 *   node --env-file=.env.local scripts/import-squared.mjs
 *
 * Uses SANITY_AUTH_TOKEN, or the token from `sanity login`.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createClient } from 'next-sanity'

const WEB_SERVICES = ['Webdesign', 'Websites', 'Applicaties', '3D-configurators']

const token =
  process.env.SANITY_AUTH_TOKEN ||
  JSON.parse(readFileSync(join(homedir(), '.config/sanity/config.json'), 'utf8')).authToken

const apiVersion = '2026-02-15'
const source = createClient({ projectId: 'lxkk53jd', dataset: 'production', apiVersion, token, useCdn: false, perspective: 'published' })
const target = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion,
  token,
  useCdn: false,
})

const cases = await source.fetch(
  `*[_type == "caseStudy" && coalesce(language, "nl") == "nl" && count(services[@ in $web]) > 0]
    | order(year desc, _createdAt desc){
      title, "slug": slug.current, client, year, url, services, cover, excerpt, stats, content,
      "videoPlaybackId": video.asset->playbackId,
      "en": *[_type == "caseStudy" && language == "en" && translationOf._ref == ^._id][0]{ title, excerpt, stats, content }
    }`,
  { web: WEB_SERVICES },
)

const uploaded = new Map()
async function copyImage(image) {
  const ref = image?.asset?._ref
  if (!ref) return undefined
  if (!uploaded.has(ref)) {
    const [, id, dims, ext] = ref.split('-')
    const res = await fetch(`https://cdn.sanity.io/images/lxkk53jd/production/${id}-${dims}.${ext}`)
    if (!res.ok) throw new Error(`Download failed for ${ref}: ${res.status}`)
    const asset = await target.assets.upload('image', Buffer.from(await res.arrayBuffer()), { filename: `${id}.${ext}` })
    uploaded.set(ref, asset._id)
  }
  const { _type, _key, hotspot, crop } = image
  return { _type, ...(_key && { _key }), asset: { _type: 'reference', _ref: uploaded.get(ref) }, hotspot, crop }
}

const strip = ({ _type, _key, ...rest }) => ({ _type, _key, ...rest })

for (const [index, c] of cases.entries()) {
  const en = c.en ?? {}
  const enText = new Map((en.content ?? []).filter((b) => b._type === 'caseText').map((b) => [b._key, b]))

  const content = []
  for (const block of c.content ?? []) {
    if (block._type === 'caseText') {
      const text = enText.get(block._key) ?? block
      content.push({ _type: 'projectText', _key: block._key, heading: text.heading, body: text.body })
    } else if (block._type === 'caseGallery') {
      content.push({
        _type: 'projectGallery',
        _key: block._key,
        images: await Promise.all((block.images ?? []).map(copyImage)),
      })
    }
  }

  const doc = {
    _id: `project-${c.slug}`,
    _type: 'project',
    title: en.title || c.title,
    slug: { _type: 'slug', current: c.slug },
    client: c.client,
    year: c.year,
    order: index + 1,
    url: c.url ?? undefined,
    services: c.services,
    cover: await copyImage(c.cover),
    videoPlaybackId: c.videoPlaybackId ?? undefined,
    excerpt: en.excerpt || c.excerpt,
    stats: (en.stats?.length ? en.stats : c.stats ?? []).map(strip),
    content,
  }

  await target.createOrReplace(doc)
  console.log(`✓ ${doc.title} (${content.length} blocks${c.en ? ', EN' : ', NL only'})`)
}

console.log(`\n${cases.length} projects, ${uploaded.size} images`)
