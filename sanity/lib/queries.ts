import { defineQuery } from 'next-sanity'

const PROJECT_CARD_FIELDS = `
  _id,
  title,
  "slug": slug.current,
  client,
  year,
  url,
  services,
  cover,
  videoPlaybackId
`

export const PROJECTS_QUERY = defineQuery(`
  *[_type == "project" && defined(slug.current)] | order(order asc, year desc){ ${PROJECT_CARD_FIELDS} }
`)

export const PROJECT_QUERY = defineQuery(`
  *[_type == "project" && slug.current == $slug][0]{
    ${PROJECT_CARD_FIELDS},
    excerpt,
    stats[]{ value, label },
    content[]{
      _key,
      _type,
      _type == "projectText" => { heading, body },
      _type == "projectGallery" => { images[]{ _key, asset, hotspot, crop, "dimensions": asset->metadata.dimensions } }
    }
  }
`)
