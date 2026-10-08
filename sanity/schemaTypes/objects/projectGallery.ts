import { defineArrayMember, defineField, defineType } from 'sanity'

export const projectGalleryType = defineType({
  name: 'projectGallery',
  title: 'Images',
  type: 'object',
  fields: [
    defineField({
      name: 'images',
      title: 'Images',
      type: 'array',
      of: [defineArrayMember({ type: 'image', options: { hotspot: true } })],
      options: { layout: 'grid' },
      validation: (r) => r.min(1),
    }),
  ],
  preview: {
    select: { images: 'images', first: 'images.0' },
    prepare: ({ images, first }) => ({
      title: 'Images',
      subtitle: `${images?.length ?? 0} image${images?.length === 1 ? '' : 's'}`,
      media: first,
    }),
  },
})
