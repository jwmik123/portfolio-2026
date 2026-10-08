import { defineArrayMember, defineField, defineType } from 'sanity'

export const projectType = defineType({
  name: 'project',
  title: 'Project',
  type: 'document',
  groups: [
    { name: 'card', title: 'Card', default: true },
    { name: 'detail', title: 'Detail page' },
  ],
  orderings: [
    { title: 'Order', name: 'orderAsc', by: [{ field: 'order', direction: 'asc' }] },
    { title: 'Year, new–old', name: 'yearDesc', by: [{ field: 'year', direction: 'desc' }] },
  ],
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (r) => r.required(), group: 'card' }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 96 },
      validation: (r) => r.required(),
      group: 'card',
    }),
    defineField({ name: 'client', title: 'Client', type: 'string', group: 'card' }),
    defineField({ name: 'year', title: 'Year', type: 'string', group: 'card' }),
    defineField({
      name: 'order',
      title: 'Order',
      type: 'number',
      description: 'Lower comes first in the work list.',
      group: 'card',
    }),
    defineField({
      name: 'url',
      title: 'Live site',
      type: 'url',
      validation: (r) => r.uri({ scheme: ['http', 'https'] }),
      group: 'card',
    }),
    defineField({
      name: 'services',
      title: 'Services',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
      options: { layout: 'tags' },
      group: 'card',
    }),
    defineField({ name: 'cover', title: 'Cover', type: 'image', options: { hotspot: true }, group: 'card' }),
    defineField({
      name: 'videoPlaybackId',
      title: 'Video (Mux playback ID)',
      type: 'string',
      description: 'Public Mux playback ID of a short silent loop. Stream: https://stream.mux.com/<id>.m3u8',
      group: 'card',
    }),
    defineField({ name: 'excerpt', title: 'Intro', type: 'text', rows: 3, group: 'detail' }),
    defineField({
      name: 'stats',
      title: 'Results',
      type: 'array',
      of: [defineArrayMember({ type: 'stat' })],
      validation: (r) => r.max(3),
      group: 'detail',
    }),
    defineField({
      name: 'content',
      title: 'Content',
      type: 'array',
      of: [defineArrayMember({ type: 'projectText' }), defineArrayMember({ type: 'projectGallery' })],
      group: 'detail',
    }),
  ],
  preview: {
    select: { title: 'title', client: 'client', year: 'year', media: 'cover' },
    prepare: ({ title, client, year, media }) => ({
      title,
      subtitle: [client, year].filter(Boolean).join(' · '),
      media,
    }),
  },
})
