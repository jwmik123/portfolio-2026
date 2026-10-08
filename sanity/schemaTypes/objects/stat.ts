import { defineField, defineType } from 'sanity'

export const statType = defineType({
  name: 'stat',
  title: 'Stat',
  type: 'object',
  fields: [
    defineField({ name: 'value', title: 'Value', type: 'string' }),
    defineField({ name: 'label', title: 'Label', type: 'string' }),
  ],
  preview: { select: { title: 'value', subtitle: 'label' } },
})
