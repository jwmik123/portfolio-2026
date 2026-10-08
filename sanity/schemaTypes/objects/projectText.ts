import { defineField, defineType } from 'sanity'

export const projectTextType = defineType({
  name: 'projectText',
  title: 'Text',
  type: 'object',
  fields: [
    defineField({ name: 'heading', title: 'Heading', type: 'string' }),
    defineField({ name: 'body', title: 'Body', type: 'text', rows: 6, validation: (r) => r.required() }),
  ],
  preview: {
    select: { title: 'heading', subtitle: 'body' },
    prepare: ({ title, subtitle }) => ({ title: title || 'Text', subtitle }),
  },
})
